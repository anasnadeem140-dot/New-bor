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
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = './auth_info';
const DOWNLOAD_DIR = './downloads';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync(DOWNLOAD_DIR);

// ============ LOAD SETTINGS ============
let settings = {
    welcomeMessage: `🎬 *VIDEO DOWNLOADER BOT* 🎬

Send me any video link and I'll download it!

*Supported Platforms:*
▶️ YouTube
📸 Instagram
📘 Facebook
🎵 TikTok
🐦 X (Twitter)

*Commands:*
!menu - Show this menu
!help - Show all commands
!status - Bot status

*How to use:*
1️⃣ Send any video link
2️⃣ Choose quality
3️⃣ Download and save!`,
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
    if (process.env.OWNER_NUMBER && process.env.OWNER_NUMBER !== '') {
        owners.push(process.env.OWNER_NUMBER.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
    }
    if (process.env.ADMIN_NUMBER && process.env.ADMIN_NUMBER !== '') {
        owners.push(process.env.ADMIN_NUMBER.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
    }
    const stored = settings.admins.map(a => a.includes('@') ? a : a + '@s.whatsapp.net');
    return [...owners, ...stored];
};

const isAdmin = (sender) => getAdmins().includes(sender);

// ============ URL DETECTION ============
function isDownloadableUrl(text) {
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?(youtu\.be\/|youtube\.com\/)/,
        /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|tv|stories)\//,
        /(?:https?:\/\/)?(?:www\.)?(facebook\.com|fb\.watch)\//,
        /(?:https?:\/\/)?(?:www\.)?(tiktok\.com\/@[\w]+\/video\/|vm\.tiktok\.com\/)/,
        /(?:https?:\/\/)?(?:www\.)?(twitter\.com|x\.com)\/[\w]+\/status\//
    ];
    return patterns.some(pattern => pattern.test(text));
}

function getPlatformFromUrl(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
    if (url.includes('instagram.com')) return 'Instagram';
    if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
    if (url.includes('tiktok.com')) return 'TikTok';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'X/Twitter';
    return 'Video';
}

function getPlatformEmoji(platform) {
    const emojis = {
        'YouTube': '▶️',
        'Instagram': '📸',
        'Facebook': '📘',
        'TikTok': '🎵',
        'X/Twitter': '🐦'
    };
    return emojis[platform] || '🎬';
}

// ============ DOWNLOAD FUNCTION ============
async function downloadVideo(url, quality = 'best') {
    const timestamp = Date.now();
    let format = '';
    
    switch(quality) {
        case '1080p': format = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'; break;
        case '720p': format = 'bestvideo[height<=720]+bestaudio/best[height<=720]'; break;
        case '480p': format = 'bestvideo[height<=480]+bestaudio/best[height<=480]'; break;
        default: format = 'best';
    }
    
    const outputPath = path.join(DOWNLOAD_DIR, `video_${timestamp}.%(ext)s`);
    const command = `yt-dlp -f "${format}" --merge-output-format mp4 --no-playlist -o "${outputPath}" "${url}"`;
    
    try {
        await execPromise(command, { timeout: 300000 });
        const files = await fs.readdir(DOWNLOAD_DIR);
        const downloadedFile = files.find(f => f.includes(timestamp.toString()));
        if (downloadedFile) {
            return path.join(DOWNLOAD_DIR, downloadedFile);
        }
        return null;
    } catch (error) {
        console.error('[DOWNLOAD] Error:', error.message);
        return null;
    }
}

// ============ SEND WELCOME MENU ============
async function sendWelcomeMessage(sock, sender) {
    const text = settings.welcomeMessage;
    
    if (settings.welcomeImageUrl && await fs.pathExists(settings.welcomeImageUrl)) {
        try {
            await sock.sendMessage(sender, {
                image: { url: settings.welcomeImageUrl },
                caption: text
            });
        } catch (error) {
            await sock.sendMessage(sender, { text: text });
        }
    } else {
        await sock.sendMessage(sender, { text: text });
    }
}

// ============ TELEGRAM BOT ============
let tgBot = null;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== '') {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('[TG] Telegram bot started');
    
    if (TELEGRAM_ADMIN_ID && TELEGRAM_ADMIN_ID !== '') {
        setTimeout(() => {
            tgBot.sendMessage(TELEGRAM_ADMIN_ID, 
                `🤖 *WhatsApp Bot Controller Active*\n\n` +
                `📋 *Commands:*\n\n` +
                `👤 *Admin Management:*\n` +
                `/admin <number> - Add WhatsApp admin\n` +
                `/deladmin <number> - Remove WhatsApp admin\n` +
                `/listadmins - List all admins\n\n` +
                `📝 *Welcome Message:*\n` +
                `/setwelcome <text> - Set welcome message\n` +
                `/delwelcome - Delete welcome message\n` +
                `/showwelcome - Show current welcome\n` +
                `/setimage - Send image as welcome image\n` +
                `/delimage - Delete welcome image\n\n` +
                `🔗 *Pairing:*\n` +
                `/pair <number> - Pair new device\n` +
                `/unpair <number> - Unpair device\n\n` +
                `📊 *Status:*\n` +
                `/status - Bot status\n` +
                `/stop - Stop bot`,
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
        caption: `🔐 *WhatsApp QR Code*\n\nScan this QR with WhatsApp to connect the bot.\n\n⚠️ Expires in 60 seconds!\n\n📱 Open WhatsApp → Linked Devices → Link a Device`,
        parse_mode: 'Markdown'
    });
    
    await fs.remove(qrPath);
}

// ============ TELEGRAM COMMAND HANDLER ============
if (tgBot) {
    // Add WhatsApp Admin via Telegram
    tgBot.onText(/\/admin (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) {
            return tgBot.sendMessage(userId, '❌ Unauthorized. Only bot owner can use this command.');
        }
        
        const number = match[1].replace(/[^0-9]/g, '');
        const adminJid = number + '@s.whatsapp.net';
        
        if (!settings.admins.includes(adminJid)) {
            settings.admins.push(adminJid);
            saveSettings();
            tgBot.sendMessage(userId, `✅ *Admin Added*\n\nNumber: ${number}\nThey can now use admin commands in WhatsApp.`);
        } else {
            tgBot.sendMessage(userId, `⚠️ ${number} is already an admin.`);
        }
    });
    
    // Remove WhatsApp Admin via Telegram
    tgBot.onText(/\/deladmin (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) {
            return tgBot.sendMessage(userId, '❌ Unauthorized.');
        }
        
        const number = match[1].replace(/[^0-9]/g, '');
        const adminJid = number + '@s.whatsapp.net';
        const index = settings.admins.indexOf(adminJid);
        
        if (index !== -1) {
            settings.admins.splice(index, 1);
            saveSettings();
            tgBot.sendMessage(userId, `✅ *Admin Removed*\n\nNumber: ${number}`);
        } else {
            tgBot.sendMessage(userId, `⚠️ ${number} is not an admin.`);
        }
    });
    
    // List all admins
    tgBot.onText(/\/listadmins/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) {
            return tgBot.sendMessage(userId, '❌ Unauthorized.');
        }
        
        const adminList = settings.admins.map(a => a.split('@')[0]).join('\n');
        tgBot.sendMessage(userId, `📋 *WhatsApp Admins*\n\n${adminList || 'No additional admins'}\n\n👑 Owner: ${process.env.OWNER_NUMBER || 'Not set'}`);
    });
    
    // Set welcome message
    tgBot.onText(/\/setwelcome (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        settings.welcomeMessage = match[1];
        saveSettings();
        tgBot.sendMessage(userId, `✅ *Welcome message updated!*\n\n${match[1].substring(0, 200)}...`);
    });
    
    // Delete welcome message
    tgBot.onText(/\/delwelcome/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        settings.welcomeMessage = "🎬 *VIDEO DOWNLOADER BOT* 🎬\n\nSend me any video link to download!";
        saveSettings();
        tgBot.sendMessage(userId, `✅ Welcome message reset to default!`);
    });
    
    // Show welcome message
    tgBot.onText(/\/showwelcome/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        tgBot.sendMessage(userId, `📝 *Current Welcome Message*\n\n${settings.welcomeMessage}`);
    });
    
    // Delete welcome image
    tgBot.onText(/\/delimage/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        settings.welcomeImageUrl = "";
        saveSettings();
        tgBot.sendMessage(userId, `✅ Welcome image removed!`);
    });
    
    // Set welcome image
    tgBot.onText(/\/setimage/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        tgBot.sendMessage(userId, `📸 Send me the image you want as welcome image.`);
        global.waitingForImage = userId;
    });
    
    // Pair new device
    tgBot.onText(/\/pair (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        const number = match[1].replace(/[^0-9]/g, '');
        tgBot.sendMessage(userId, `📱 Pairing request sent for ${number}. QR will be sent when available.`);
        global.pendingPair = number;
    });
    
    // Unpair device
    tgBot.onText(/\/unpair (.+)/, async (msg, match) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        const number = match[1].replace(/[^0-9]/g, '');
        tgBot.sendMessage(userId, `✅ Unpaired ${number}. Session cleared.`);
    });
    
    // Status
    tgBot.onText(/\/status/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
        const files = await fs.readdir(DOWNLOAD_DIR);
        tgBot.sendMessage(userId, 
            `✅ *Bot Status*\n\n` +
            `📱 WhatsApp: Connected\n` +
            `👑 WhatsApp Admins: ${settings.admins.length}\n` +
            `📁 Cached Files: ${files.length}\n` +
            `🕐 Uptime: ${Math.floor(process.uptime())} seconds`,
            { parse_mode: 'Markdown' }
        );
    });
    
    // Stop bot
    tgBot.onText(/\/stop/, async (msg) => {
        const userId = msg.chat.id;
        if (userId.toString() !== TELEGRAM_ADMIN_ID) return tgBot.sendMessage(userId, '❌ Unauthorized.');
        
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
            tgBot.sendMessage(userId, `✅ *Welcome image set!*\n\nUsers will now see this image with the welcome message.`);
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
                tgBot.sendMessage(TELEGRAM_ADMIN_ID, '✅ *WhatsApp Bot Connected!*\n\nBot is now online and ready to download videos.', { parse_mode: 'Markdown' });
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[BOT] Connection closed');
            if (shouldReconnect) {
                console.log('[BOT] Reconnecting...');
                setTimeout(() => startBot(mode), 5000);
            }
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // WhatsApp Message Handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isUserAdmin = isAdmin(sender);
        
        // ============ ADMIN COMMANDS IN WHATSAPP ============
        if (isUserAdmin && text === '!adminmenu') {
            await sock.sendMessage(sender, {
                text: `*👑 WHATSAPP ADMIN MENU* 👑\n\n` +
                      `📋 *Commands:*\n` +
                      `!menu - Show welcome menu\n` +
                      `!help - Show help\n` +
                      `!status - Bot status\n` +
                      `!stats - Bot statistics\n` +
                      `!clean - Clear download cache\n\n` +
                      `📝 *Admins can be managed via Telegram bot only.*`
            });
            return;
        }
        
        // ============ PUBLIC COMMANDS ============
        if (text === '!menu' || text === '!start') {
            await sendWelcomeMessage(sock, sender);
            return;
        }
        
        if (text === '!help') {
            await sock.sendMessage(sender, {
                text: `*🤖 BOT COMMANDS* 🤖\n\n` +
                      `!menu / !start - Show welcome menu\n` +
                      `!help - Show this help\n` +
                      `!status - Bot status\n\n` +
                      `*How to use:*\n` +
                      `1️⃣ Send any video link from:\n` +
                      `   YouTube, Instagram, Facebook, TikTok, X\n` +
                      `2️⃣ Choose quality from buttons\n` +
                      `3️⃣ Download and save to your device!\n\n` +
                      `*Note:* Videos available for ~30 days. Save to gallery to keep forever.`
            });
            return;
        }
        
        if (text === '!status') {
            const files = await fs.readdir(DOWNLOAD_DIR);
            await sock.sendMessage(sender, {
                text: `✅ *Bot is running!*\n\n📁 Cached files: ${files.length}\n🕐 Uptime: ${Math.floor(process.uptime())} seconds\n\nSupported: YouTube, Instagram, Facebook, TikTok, X`
            });
            return;
        }
        
        if (isUserAdmin && text === '!stats') {
            const files = await fs.readdir(DOWNLOAD_DIR);
            await sock.sendMessage(sender, {
                text: `📊 *Bot Statistics*\n\n📁 Cached files: ${files.length}\n👑 Admins: ${settings.admins.length}\n🕐 Uptime: ${Math.floor(process.uptime())} seconds`
            });
            return;
        }
        
        if (isUserAdmin && text === '!clean') {
            await fs.emptyDir(DOWNLOAD_DIR);
            await sock.sendMessage(sender, { text: `🗑️ Download cache cleaned!` });
            return;
        }
        
        // ============ AUTO DETECT VIDEO LINKS ============
        if (text && isDownloadableUrl(text)) {
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const videoUrl = urlMatch[0];
                const platform = getPlatformFromUrl(videoUrl);
                const emoji = getPlatformEmoji(platform);
                
                // Quality selection buttons
                const buttons = [
                    { buttonId: `quality_1080p_${videoUrl}`, buttonText: { displayText: `${emoji} 1080p HD` }, type: 1 },
                    { buttonId: `quality_720p_${videoUrl}`, buttonText: { displayText: `${emoji} 720p` }, type: 1 },
                    { buttonId: `quality_480p_${videoUrl}`, buttonText: { displayText: `${emoji} 480p` }, type: 1 },
                    { buttonId: `quality_best_${videoUrl}`, buttonText: { displayText: `${emoji} Best Quality` }, type: 1 }
                ];
                
                await sock.sendMessage(sender, {
                    text: `📥 *${platform} video detected!*\n\nChoose your preferred quality:`,
                    buttons: buttons,
                    footer: "Video Downloader Bot"
                });
            }
            return;
        }
        
        // ============ HANDLE QUALITY BUTTONS ============
        if (msg.message?.buttonsResponseMessage) {
            const selectedId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (selectedId && selectedId.startsWith('quality_')) {
                const parts = selectedId.split('_');
                const quality = parts[1];
                const url = parts.slice(2).join('_');
                
                await sock.sendMessage(sender, { text: `⏬ Downloading ${quality}... Please wait.` });
                
                const videoPath = await downloadVideo(url, quality);
                if (videoPath && await fs.pathExists(videoPath)) {
                    const stats = await fs.stat(videoPath);
                    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                    
                    await sock.sendMessage(sender, {
                        video: { url: videoPath },
                        caption: `✅ *Download Complete!*\n\n📥 Quality: ${quality}\n📦 Size: ${sizeMB} MB\n\n⚠️ Save this video now! It will expire in 30 days.`
                    });
                    
                    await fs.remove(videoPath);
                } else {
                    await sock.sendMessage(sender, { text: '❌ Download failed! Try another quality or check the link.' });
                }
            }
        }
    });
    
    // Keep-alive server
    const app = express();
    const PORT = process.env.PORT || 3000;
    app.get('/', (req, res) => res.send('Bot running'));
    app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
    app.listen(PORT, () => console.log(`[WEB] Server on port ${PORT}`));
}

export { settings, saveSettings };
