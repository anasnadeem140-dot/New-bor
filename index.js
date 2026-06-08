#!/usr/bin/env node

import { createInterface } from 'readline';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ UTILITIES ============
const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (question) => new Promise(resolve => rl.question(question, resolve));

const clearScreen = () => {
    console.clear();
    console.log('='.repeat(50));
    console.log('   WHATSAPP BOT SETUP - v1.0');
    console.log('='.repeat(50));
};

// ============ SAVE CONFIG ============
const saveConfig = (config) => {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    for (const [key, value] of Object.entries(config)) {
        if (value && value !== 'skip' && value !== '') {
            envContent += `${key}=${value}\n`;
        }
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Configuration saved to .env file');
};

// ============ OPTION 1: DIRECT QR (No Telegram) ============
async function optionDirectQR() {
    clearScreen();
    console.log('📱 DIRECT QR MODE\n');
    
    // Ask for WhatsApp number to connect
    let waNumber = await ask('📞 Your WhatsApp number (with country code, no +): ');
    waNumber = waNumber.replace(/[^0-9]/g, '');
    
    if (!waNumber || waNumber.length < 10) {
        console.log('❌ Invalid number. Using default...');
        waNumber = '';
    }
    
    // Ask for admin number (optional)
    let adminNumber = await ask('👑 Admin number (press Enter to skip): ');
    adminNumber = adminNumber.replace(/[^0-9]/g, '');
    
    // Save config
    saveConfig({
        OWNER_NUMBER: waNumber,
        ADMIN_NUMBER: adminNumber || '',
        BOT_PREFIX: '!',
        PORT: 3000
    });
    
    console.log('\n🚀 Starting WhatsApp bot...');
    console.log('⚠️ QR code will appear below. Scan with WhatsApp.\n');
    
    // Dynamically import and start bot
    const { startBot } = await import('./whatsapp-core.js');
    startBot('direct');
}

// ============ OPTION 2: QR WITH TELEGRAM ============
async function optionTelegramQR() {
    clearScreen();
    console.log('🤖 TELEGRAM QR MODE\n');
    
    // Telegram Bot Token
    let tgToken = await ask('🔑 Telegram Bot Token (from @BotFather): ');
    if (!tgToken || tgToken === '') {
        console.log('❌ Bot token required for this mode.');
        return;
    }
    
    // Telegram Admin ID
    let tgAdminId = await ask('👑 Your Telegram User ID (press Enter to skip): ');
    tgAdminId = tgAdminId.replace(/[^0-9]/g, '');
    
    // WhatsApp number (optional)
    let waNumber = await ask('📞 Your WhatsApp number (optional, press Enter to skip): ');
    waNumber = waNumber.replace(/[^0-9]/g, '');
    
    // Admin number (optional)
    let adminNumber = await ask('👑 WhatsApp Admin number (optional, press Enter to skip): ');
    adminNumber = adminNumber.replace(/[^0-9]/g, '');
    
    // Save config
    saveConfig({
        TELEGRAM_BOT_TOKEN: tgToken,
        TELEGRAM_ADMIN_ID: tgAdminId || '',
        OWNER_NUMBER: waNumber,
        ADMIN_NUMBER: adminNumber || '',
        BOT_PREFIX: '!',
        PORT: 3000
    });
    
    console.log('\n🚀 Starting bot with Telegram support...');
    console.log('📨 QR code will be sent to your Telegram if ID provided.\n');
    
    // Dynamically import and start bot
    const { startBot } = await import('./whatsapp-core.js');
    startBot('telegram');
}

// ============ MAIN MENU ============
async function mainMenu() {
    clearScreen();
    console.log('\n📋 MAIN MENU\n');
    console.log('1. 🔓 Direct QR Code (No Telegram)');
    console.log('2. 🤖 QR Code via Telegram');
    console.log('3. ❌ Exit\n');
    
    const choice = await ask('Select option (1-3): ');
    
    switch(choice) {
        case '1':
            await optionDirectQR();
            break;
        case '2':
            await optionTelegramQR();
            break;
        case '3':
            console.log('\n👋 Goodbye!');
            rl.close();
            process.exit(0);
            break;
        default:
            console.log('\n❌ Invalid option. Try again.');
            await ask('\nPress Enter to continue...');
            await mainMenu();
    }
}

// ============ START ============
mainMenu().catch(console.error);
