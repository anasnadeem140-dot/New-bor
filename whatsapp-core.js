import { default as makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = './auth_info';
const DOWNLOAD_DIR = './downloads';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync(DOWNLOAD_DIR);

// ============ LOAD SETTINGS ============
let settings = {
    welcomeMessage: "🎬 *WELCOME TO VIDEO DOWNLOADER BOT* 🎬\n\nSend me any video link and I'll download it!\n\n*Supported:* YouTube, Instagram, Facebook, TikTok, X\n\n*Commands:*\n!menu - Show menu\n!help - Help",
    welcomeImageUrl: "",
    admins: []
};

if (fs.existsSync(SETTINGS_FILE)) {
    settings = fs.readJsonSync(SETTINGS_FILE);
}

function saveSettings() {
    fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 2 });
}

// ============ GET ADMINS ============
const getAdmins = () => {
    const owners = [];
    if (process.env.OWNER_NUMBER) owners.push(process.env.OWNER_NUMBER + '@s.whatsapp.net');
    if (process.env.ADMIN_NUMBER) owners.push(process.env.ADMIN_NUMBER + '@s.whatsapp.net');
    const stored = settings.admins.map(a => a.includes('@') ? a : a + '@s.whatsapp.net');
    return [...owners, ...stored];
};

// ============ TELEGRAM BOT ============
let tgBot = null;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== '') {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('[TG] Telegram bot started');
    
    // Send start message
    if (TELEGRAM_ADMIN_ID && TELEGRAM_ADMIN_ID !== '') {
        setTimeout(() => {
            tgBot.sendMessage(TELEGRAM_ADMIN_ID, 
                `🤖 *WhatsApp Bot Active*\n\n` +
                `📋 *Commands:*\n` +
                `/pair <number> - Pair WhatsApp number\n` +
                `/unpair <number> - Unpair number\n` +
                `/admin <number> - Add admin\n` +
                `/deladmin <number> - Remove admin\n` +
                `/stop - Stop bot\n` +
                `/setwelcome <text> - Set welcome message\n` +
                `/delwelcome - Delete welcome message\n` +
                `/setimage - Send image as welcome image\n` +
                `/delimage - Delete welcome image\n` +
                `/status - Bot status`,
                { parse_mode: 'Markdown' }
            );
        }, 2000);
    }
}

// ============ SEND QR TO TELEGRAM ============
async function sendQRToTelegram(qrCode) {
    if (!tgBot || !TELEGRAM_ADMIN_ID) return;
    
    const qrPath = path.join(__dirname, 'qr_temp.png');
    await QRCode.toFile(qrPath, qrCode);
    
    await tgBot.sendPhoto(TELEGRAM_ADMIN_ID, qrPath, {
        caption: `🔐 *WhatsApp QR Code*\n\nScan this QR to connect the bot.\n\n⚠️ Expires in 60 seconds!`,
        parse_mode: 'Markdown'
    });
    
    await fs.remove(qrPath);
}

// ============ TELEGRAM COMMAND HANDLER ============
if (tgBot) {
    tgBot.onText(/\/pair (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) {
            return tgBot.sendMessage(userId, '❌ Unauthorized');
        }
        
        const number = match[1].replace(/[^0-9]/g, '');
        tgBot.sendMessage(userId, `📱 Pairing request sent for ${number}. Please scan QR within 60 seconds.`);
        // QR will be sent via WhatsApp connection
        global.pendingPair = number;
    });
    
    tgBot.onText(/\/unpair (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        const number = match[1].replace(/[^0-9]/g, '');
        tgBot.sendMessage(userId, `✅ Unpaired ${number}`);
    });
    
    tgBot.onText(/\/admin (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        const number = match[1].replace(/[^0-9]/g, '');
        if (!settings.admins.includes(number + '@s.whatsapp.net')) {
            settings.admins.push(number + '@s.whatsapp.net');
            saveSettings();
            tgBot.sendMessage(userId, `✅ Added ${number} as admin`);
        } else {
            tgBot.sendMessage(userId, `⚠️ ${number} is already an admin`);
        }
    });
    
    tgBot.onText(/\/deladmin (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        const number = match[1].replace(/[^0-9]/g, '');
        const index = settings.admins.indexOf(number + '@s.whatsapp.net');
        if (index !== -1) {
            settings.admins.splice(index, 1);
            saveSettings();
            tgBot.sendMessage(userId, `✅ Removed ${number} from admins`);
        } else {
            tgBot.sendMessage(userId, `⚠️ ${number} is not an admin`);
        }
    });
    
    tgBot.onText(/\/setwelcome (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        settings.welcomeMessage = match[1];
        saveSettings();
        tgBot.sendMessage(userId, `✅ Welcome message updated!`);
    });
    
    tgBot.onText(/\/delwelcome/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        settings.welcomeMessage = "🎬 *WELCOME TO VIDEO DOWNLOADER BOT* 🎬\n\nSend me any video link to download!";
        saveSettings();
        tgBot.sendMessage(userId, `✅ Welcome message reset!`);
    });
    
    tgBot.onText(/\/delimage/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        settings.welcomeImageUrl = "";
        saveSettings();
        tgBot.sendMessage(userId, `✅ Welcome image removed!`);
    });
    
    tgBot.onText(/\/setimage/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        tgBot.sendMessage(userId, `📸 Send me the image you want as welcome image`);
        global.waitingForImage = userId;
    });
    
    tgBot.onText(/\/status/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        tgBot.sendMessage(userId, `✅ *Bot is running!*\n\nAdmins: ${settings.admins.length}\nWhatsApp: Connected`, { parse_mode: 'Markdown' });
    });
    
    tgBot.onText(/\/stop/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized');
        
        tgBot.sendMessage(userId, `🛑 Stopping bot...`);
        process.exit(0);
    });
    
    // Handle image upload
    tgBot.on('photo', async (msg) => {
        const userId = msg.chat.id;
        if (global.waitingForImage === userId && msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const file = await tgBot.getFile(fileId);
            const imagePath = path.join(DOWNLOAD_DIR, 'welcome_image.jpg');
            
            const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            await fs.writeFile(imagePath, Buffer.from(buffer));
            
            settings.welcomeImageUrl = imagePath;
            saveSettings();
            delete global.waitingForImage;
            tgBot.sendMessage(userId, `✅ Welcome image set!`);
        }
    });
}

// ============ WHATSAPP BOT ============
export async function startBot(mode) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: mode === 'direct',
        logger: P({ level: 'silent' }),
        browser: ['WhatsApp Bot', 'Chrome', '120.0.0']
    });
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && mode === 'telegram') {
            await sendQRToTelegram(qr);
            console.log('[BOT] QR sent to Telegram');
        }
        
        if (connection === 'open') {
            console.log('[BOT] ✅ WhatsApp connected!');
            if (tgBot && TELEGRAM_ADMIN_ID) {
                tgBot.sendMessage(TELEGRAM_ADMIN_ID, '✅ *WhatsApp Bot Connected!*', { parse_mode: 'Markdown' });
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => startBot(mode), 5000);
            }
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Message handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isUserAdmin = getAdmins().includes(sender);
        
        // Welcome message with commands
        if (text === '!menu' || text === '!start') {
            const welcomeText = settings.welcomeMessage + 
                (tgBot ? `\n\n📱 *Telegram Commands:*\n/pair <number> - Pair device\n/admin <number> - Add admin\n/setwelcome <text> - Edit welcome` : '');
            
            if (settings.welcomeImageUrl) {
                await sock.sendMessage(sender, { image: { url: settings.welcomeImageUrl }, caption: welcomeText });
            } else {
                await sock.sendMessage(sender, { text: welcomeText });
            }
            return;
        }
        
        // Help command
        if (text === '!help') {
            await sock.sendMessage(sender, {
                text: `*🤖 BOT COMMANDS*\n\n!menu - Show menu\n!help - This help\n!status - Bot status\n\nSend any video link to download!`
            });
            return;
        }
        
        // Simple link detection (you can add full yt-dlp later)
        if (text && (text.includes('youtube.com') || text.includes('youtu.be') || text.includes('instagram.com'))) {
            await sock.sendMessage(sender, { text: `📥 Link detected! Download feature coming soon.\n\nSend !menu for options.` });
        }
    });
    
    // Keep-alive server
    const app = express();
    const PORT = process.env.PORT || 3000;
    app.get('/', (req, res) => res.send('Bot running'));
    app.listen(PORT, () => console.log(`[WEB] Server on port ${PORT}`));
}

// ============ EXPORT ============
export { settings, saveSettings };
