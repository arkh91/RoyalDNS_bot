// ─────────────────────────────────────────────────────────────────────────────
//  main.js  –  Royal DNS Telegram Bot
// ─────────────────────────────────────────────────────────────────────────────

const axios   = require('axios');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const db      = require('./db');
const mysql   = require('mysql');
const fs      = require('fs');
const https   = require('https');
const tokens  = require('./tokens');

console.log("MySQL module loaded successfully");

// ───── Load / watch callbacks.json ───────────────────────────────────────
let callbackToServer = {};
let callbackToInternationalServer = {};

function loadConfig() {
    const raw = fs.readFileSync('./callbacks.json');
    const config = JSON.parse(raw);
    callbackToServer = config.callbackToServer;
    callbackToInternationalServer = config.callbackToInternationalServer;
    console.log('✅ Callbacks loaded');
}
loadConfig();
fs.watchFile('./callbacks.json', { interval: 2000 }, () => {
    try {
        console.log('⚡ callbacks.json updated, reloading...');
        loadConfig();
    } catch (err) {
        console.error('❌ Failed to reload callbacks.json:', err);
    }
});

// ───── Bot initialisation ─────────────────────────────────────────────────
const bot = new TelegramBot(tokens.royalDNS, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

// ───── MENUS (MUST BE BEFORE /start) ─────────────────────────────────────
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🧭 Get DNS Key',   callback_data: 'menu_1' }],
            [{ text: '🔑 My Keys',       callback_data: 'menu_mykeys' }],
            [{ text: '📞 Support',       callback_data: 'menu_support' }]
        ]
    }
};

const subMenus = {
    // ── Step 1: Choose method ───────────────────────────────────────
    menu_1: {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🤖 Android only',     callback_data: 'sub_android' }],
                [{ text: '💻 All Devices',      callback_data: 'sub_alldevices' }],
                [{ text: '⬅️ Go Back',          callback_data: 'back_to_main' }]
            ]
        }
    },

    // ── Step 2: Android → Choose Country ───────────────────────────
    sub_country: {
        text: 'Choose a high-speed location for fast and secure internet:',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Germany', callback_data: 'speed_ger' },
                    { text: 'Sweden', callback_data: 'speed_sweden' }
                ],
                [
                    { text: 'Finland', callback_data: 'speed_fin' },
                    { text: 'Italy',   callback_data: 'speed_it' }
                ],
                [
                    { text: 'India',   callback_data: 'speed_in' },
                    { text: 'UAE',     callback_data: 'speed_uae' }
                ],
                [
                    { text: 'UK',      callback_data: 'speed_uk' },
                    { text: 'USA',     callback_data: 'speed_usa' }
                ],
                [{ text: '⬅️ Go Back', callback_data: 'menu_1' }]
            ]
        }
    },

    // ── Step 3: Android → Choose Duration ───────────────────────────
    sub_android_duration: {
        text: 'Select your subscription duration\n\nBest value plans for high-speed DNS:',
        reply_markup: {
            inline_keyboard: [
                [{ text: '1 Month - $1.00 ($1.00/mo) Entry plan',      callback_data: 'dur_1m' }],
                [{ text: '2 Months - $1.80 ($0.90/mo) Save 10%',      callback_data: 'dur_2m' }],
                [{ text: '3 Months - $2.50 ($0.83/mo) Most popular',  callback_data: 'dur_3m' }],
                [{ text: '6 Months - $4.00 ($0.67/mo) Long-term',     callback_data: 'dur_6m' }],
                [{ text: '12 Months - $7.00 ($0.58/mo) Best value',   callback_data: 'dur_12m' }],
                [{ text: '⬅️ Go Back',                                      callback_data: 'sub_country' }]
            ]
        }
    }
};

// ───── /start command ─────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
    try {
        console.log(`Start – chat ${msg.chat.id}`);
        // await insertUser(msg.from);
        // await insertVisit(msg.from.id);
    } catch (err) {
        console.error('Error inserting user:', err);
    }

    const welcome = `Dominate the competition with a DNS server engineered for gaming. `
                  + `Experience lower ping, reduced packet loss, and a more stable connection. `
                  + `Our global network provides a faster, more responsive gaming experience `
                  + `while blocking malicious sites. Set up in minutes and feel the difference.\n\n`
                  + `Choose your preferred DNS setup below`;

    bot.sendMessage(msg.chat.id, welcome, mainMenu);  // Now works!
});

// ───── Callback query handler – ONLY `if` statements ─────────────────────
bot.on('callback_query', async (query) => {
    const chatId    = query.message.chat.id;
    const messageId = query.message.message_id;
    const data      = query.data;

    //console.log(`Callback: ${data}`);

    try {
        // ── Main menu ─────────────────────────────────────────────────────
        if (data === 'menu_1') {
            await bot.editMessageText(
                "Choose your DNS setup method:",
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: subMenus.menu_1.reply_markup
                }
            );
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'menu_mykeys') {
            await bot.editMessageText(
                "Here are your active DNS keys:\n\n_(Coming soon...)_",
                { chat_id: chatId, message_id: messageId }
            );
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'menu_support') {
            await bot.editMessageText(
                "Need help?\n\nContact support: @YourSupportUsername\nOr email: support@royaldns.com",
                { chat_id: chatId, message_id: messageId }
            );
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'back_to_main') {
            const welcome = `Dominate the competition with a DNS server engineered for gaming. `
                          + `Experience lower ping, reduced packet loss, and a more stable connection. `
                          + `Our global network provides a faster, more responsive gaming experience `
                          + `while blocking malicious sites. Set up in minutes and feel the difference.\n\n`
                          + `Choose your preferred DNS setup below`;

            await bot.editMessageText(welcome, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: mainMenu.reply_markup  // Now defined!
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // ── Android → Choose Country ─────────────────────────────────────
        if (data === 'sub_android') {
            await bot.editMessageText(
                subMenus.sub_country.text,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: subMenus.sub_country.reply_markup
                }
            );
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // ── Country selected → go to Duration ───────────────────────────
        if (data.startsWith('speed_')) {
            const countryCode = data.replace('speed_', '').toUpperCase();
            await bot.editMessageText(
                subMenus.sub_android_duration.text,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "Markdown",
                    reply_markup: subMenus.sub_android_duration.reply_markup
                }
            );
            await bot.answerCallbackQuery(query.id, { text: `${countryCode} selected` });
            return;
        }

        // ── Duration selected (final step) ───────────────────────────────
        if (data.startsWith('dur_')) {
            const months = data.replace('dur_', '').replace('m', '');
            const pricing = {
                '1': '$1.00 ($1.00/mo) Entry plan',
                '2': '$1.80 ($0.90/mo) Save 10%',
                '3': '$2.50 ($0.83/mo) Most popular',
                '6': '$4.00 ($0.67/mo) Long-term',
                '12': '$7.00 ($0.58/mo) Best value'
            };
            await bot.editMessageText(
                `You selected **${months} Month${months === '1' ? '' : 's'}** plan for **${pricing[months]}**!\n\n` +
                "Generating your DNS key...\n\n" +
                "`https://dns.royalgaming.com/dns-query` (Intra App)\n\n" +
                `Key will expire in ${months * 30} days.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Back to Duration', callback_data: 'sub_country' }],
                            [{ text: 'Main Menu',        callback_data: 'back_to_main' }]
                        ]
                    }
                }
            );
            await bot.answerCallbackQuery(query.id, { text: `Selected ${months} month(s)!` });
            return;
        }

        // ── All Devices (IP-Based) ─────────────────────────────────────
        if (data === 'sub_alldevices') {
            await bot.editMessageText(
                "**IP-Based DNS (All Devices)**\n\n" +
                "Primary: `103.194.24.1`\n" +
                "Secondary: `103.194.24.2`\n\n" +
                "Works on PC, consoles, iOS, Android, routers.",
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "Markdown",
                    reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'menu_1' }]] }
                }
            );
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // ── Fallback ───────────────────────────────────────────────────
        await bot.answerCallbackQuery(query.id, { text: 'Unknown option.' });

    } catch (err) {
        console.error('Callback error:', err);
        try { await bot.answerCallbackQuery(query.id, { text: 'Error occurred.' }); }
        catch (e) { console.error('Failed to answer callback:', e); }
    }
});
