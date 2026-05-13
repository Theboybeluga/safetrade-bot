require('dotenv').config();

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

/* ======================
   ENV CHECK
====================== */
if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is missing');
}

if (!process.env.ADMIN_ID) {
    throw new Error('ADMIN_ID is missing');
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});

const ADMIN_ID = String(process.env.ADMIN_ID);
const DB_FILE = './database.json';

/* ======================
   RENDER KEEP-ALIVE SERVER
====================== */
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SafeTrade Bot Running');
}).listen(process.env.PORT || 3000);

/* ======================
   DATABASE
====================== */
function loadDB() {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const db = JSON.parse(raw);

        if (!db.users) db.users = {};
        if (!db.transactions) db.transactions = {};

        return db;
    } catch (err) {
        return {
            users: {},
            transactions: {}
        };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function genId() {
    return 'ST' +
        crypto.randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)
        .toUpperCase();
}

function findTx(db, id) {
    return db.transactions[id] || null;
}

function isAdmin(chatId) {
    return String(chatId) === ADMIN_ID;
}

/* ======================
   HELP MESSAGE
====================== */
function sendHelp(chatId) {
    bot.sendMessage(chatId,
`ℹ️ *HOW SAFETRADE WORKS*

1️⃣ Buyer creates a deal

2️⃣ Buyer enters:
• Amount
• Seller Telegram ID

3️⃣ Buyer marks as paid

4️⃣ Seller ships item

5️⃣ Buyer releases funds

⏱ Funds auto-release after shipping if buyer does not respond.

🚨 Disputes can be opened anytime.

━━━━━━━━━━━━━━━

To get your Telegram ID:
Message @userinfobot`,
        {
            parse_mode: 'Markdown'
        }
    );
}

/* ======================
   MENU
====================== */
function sendMenu(chatId) {

    const db = loadDB();
    const user = db.users[chatId];

    const allTx = Object.values(db.transactions);

    const registered = user && user.name;

    const buyerDeals = allTx.filter(t =>
        String(t.buyer) === String(chatId)
    );

    const sellerDeals = allTx.filter(t =>
        String(t.seller) === String(chatId)
    );

    const keyboard = [];

    if (!registered) {

        keyboard.push([
            {
                text: '📝 Register',
                callback_data: 'register'
            }
        ]);

        keyboard.push([
            {
                text: 'ℹ️ How It Works',
                callback_data: 'help'
            }
        ]);

        bot.sendMessage(chatId,
`🔒 *SafeTrade Escrow*

Buy and sell safely online in Ghana.

Please register to continue.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );

        return;
    }

    keyboard.push([
        {
            text: '💰 Create Deal',
            callback_data: 'create'
        }
    ]);

    if (buyerDeals.length || sellerDeals.length) {
        keyboard.push([
            {
                text: '📦 My Deals',
                callback_data: 'mydeals'
            }
        ]);
    }

    keyboard.push([
        {
            text: 'ℹ️ Help',
            callback_data: 'help'
        }
    ]);

    if (isAdmin(chatId)) {
        keyboard.push([
            {
                text: '🛠 Admin Panel',
                callback_data: 'admin'
            }
        ]);
    }

    bot.sendMessage(chatId,
`👋 Welcome back *${user.name}*

Choose an option below.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
}

/* ======================
   START
====================== */
bot.onText(/\/start/, (msg) => {

    const chatId = msg.chat.id;

    const db = loadDB();

    if (db.users[chatId]) {
        delete db.users[chatId].step;
        delete db.users[chatId].action;
        saveDB(db);
    }

    sendMenu(chatId);
});

/* ======================
   CANCEL
====================== */
bot.onText(/\/cancel/, (msg) => {

    const chatId = msg.chat.id;

    const db = loadDB();

    if (db.users[chatId]) {
        delete db.users[chatId].step;
        delete db.users[chatId].action;
        saveDB(db);
    }

    bot.sendMessage(chatId,
`❌ Cancelled

Send /start to return to menu.`);
});

/* ======================
   HELP
====================== */
bot.onText(/\/help/, (msg) => {
    sendHelp(msg.chat.id);
});

/* ======================
   CALLBACKS
====================== */
bot.on('callback_query', (query) => {

    const chatId = query.message.chat.id;
    const data = query.data;

    const db = loadDB();

    bot.answerCallbackQuery(query.id);

    /* REGISTER */
    if (data === 'register') {

        db.users[chatId] = db.users[chatId] || {};

        db.users[chatId].step = 'register_name';

        saveDB(db);

        bot.sendMessage(chatId,
`📝 Enter your full name

Send /cancel to stop.`);

        return;
    }

    /* HELP */
    if (data === 'help') {
        sendHelp(chatId);
        return;
    }

    /* CREATE DEAL */
    if (data === 'create') {

        const user = db.users[chatId];

        if (!user || !user.name) {
            bot.sendMessage(chatId,
`⚠️ Register first.`);
            return;
        }

        const txId = genId();

        db.transactions[txId] = {
            id: txId,
            buyer: chatId,
            buyerName: user.name,
            step: 'amount',
            status: 'pending'
        };

        saveDB(db);

        bot.sendMessage(chatId,
`💰 Enter amount in GHS

Example:
150`);

        return;
    }

    /* MY DEALS */
    if (data === 'mydeals') {

        const deals = Object.values(db.transactions)
        .filter(t =>
            String(t.buyer) === String(chatId) ||
            String(t.seller) === String(chatId)
        );

        if (!deals.length) {
            bot.sendMessage(chatId,
`📦 No deals found.`);
            return;
        }

        deals.forEach(tx => {

            const buttons = [];

            if (
                String(tx.buyer) === String(chatId) &&
                tx.status === 'waiting_payment'
            ) {
                buttons.push([
                    {
                        text: '💳 Mark Paid',
                        callback_data: `paid_${tx.id}`
                    }
                ]);
            }

            if (
                String(tx.seller) === String(chatId) &&
                tx.status === 'paid'
            ) {
                buttons.push([
                    {
                        text: '🚚 Mark Shipped',
                        callback_data: `shipped_${tx.id}`
                    }
                ]);
            }

            if (
                String(tx.buyer) === String(chatId) &&
                tx.status === 'shipped'
            ) {
                buttons.push([
                    {
                        text: '🔓 Release Funds',
                        callback_data: `release_${tx.id}`
                    }
                ]);

                buttons.push([
                    {
                        text: '🚨 Raise Dispute',
                        callback_data: `dispute_${tx.id}`
                    }
                ]);
            }

            bot.sendMessage(chatId,
`📦 *Deal ${tx.id}*

💰 Amount: GHS ${tx.amount || 'N/A'}
📊 Status: ${tx.status}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: buttons
                    }
                }
            );
        });

        return;
    }

    /* PAID */
    if (data.startsWith('paid_')) {

        const txId = data.split('_')[1];

        const tx = findTx(db, txId);

        if (!tx) return;

        tx.status = 'paid';

        saveDB(db);

        bot.sendMessage(chatId,
`💳 Deal marked as paid.`);

        if (tx.seller) {
            bot.sendMessage(tx.seller,
`💳 Buyer marked payment as sent.

Deal: ${tx.id}`);
        }

        return;
    }

    /* SHIPPED */
    if (data.startsWith('shipped_')) {

        const txId = data.split('_')[1];

        const tx = findTx(db, txId);

        if (!tx) return;

        tx.status = 'shipped';

        saveDB(db);

        bot.sendMessage(chatId,
`🚚 Deal marked as shipped.`);

        bot.sendMessage(tx.buyer,
`🚚 Seller shipped your item.

Deal: ${tx.id}

You can now release funds.`);

        /* AUTO RELEASE */
        setTimeout(() => {

            const db2 = loadDB();

            const t = db2.transactions[txId];

            if (t && t.status === 'shipped') {

                t.status = 'completed';

                saveDB(db2);

                bot.sendMessage(t.buyer,
`🔓 Funds auto released.`);

                if (t.seller) {
                    bot.sendMessage(t.seller,
`💰 Funds released automatically.`);
                }
            }

        }, 10 * 60 * 1000);

        return;
    }

    /* RELEASE */
    if (data.startsWith('release_')) {

        const txId = data.split('_')[1];

        const tx = findTx(db, txId);

        if (!tx) return;

        tx.status = 'completed';

        saveDB(db);

        bot.sendMessage(chatId,
`✅ Funds released.`);

        if (tx.seller) {
            bot.sendMessage(tx.seller,
`💰 Buyer released funds.`);
        }

        return;
    }

    /* DISPUTE */
    if (data.startsWith('dispute_')) {

        const txId = data.split('_')[1];

        const tx = findTx(db, txId);

        if (!tx) return;

        tx.status = 'disputed';

        saveDB(db);

        bot.sendMessage(chatId,
`🚨 Dispute opened.`);

        bot.sendMessage(ADMIN_ID,
`🚨 DISPUTE ALERT

Deal: ${tx.id}
Amount: GHS ${tx.amount}`);
    }

    /* ADMIN */
    if (data === 'admin' && isAdmin(chatId)) {

        const txs = Object.values(db.transactions);

        bot.sendMessage(chatId,
`🛠 ADMIN PANEL

📦 Total Deals: ${txs.length}

Commands:
TXID force
TXID refund`);
    }

});

/* ======================
   MESSAGE HANDLER
====================== */
bot.on('message', (msg) => {

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const db = loadDB();

    const user = db.users[chatId];

    /* ADMIN COMMANDS */
    if (isAdmin(chatId)) {

        const parts = text.split(' ');

        const txId = parts[0];
        const cmd = parts[1];

        const tx = findTx(db, txId);

        if (tx && cmd === 'force') {

            tx.status = 'completed';

            saveDB(db);

            bot.sendMessage(chatId,
`✅ Forced release completed.`);

            return;
        }

        if (tx && cmd === 'refund') {

            tx.status = 'refunded';

            saveDB(db);

            bot.sendMessage(chatId,
`↩️ Buyer refunded.`);

            return;
        }
    }

    /* REGISTER FLOW */
    if (user?.step === 'register_name') {

        user.name = text.trim();

        user.step = null;

        saveDB(db);

        bot.sendMessage(chatId,
`✅ Registration successful

Welcome ${user.name}`);

        sendMenu(chatId);

        return;
    }

    /* CREATE DEAL FLOW */
    let tx = Object.values(db.transactions)
    .find(t =>
        String(t.buyer) === String(chatId) &&
        t.step === 'amount'
    );

    if (tx) {

        const amount = parseFloat(text);

        if (isNaN(amount)) {
            bot.sendMessage(chatId,
`⚠️ Invalid amount.`);
            return;
        }

        tx.amount = amount;
        tx.step = 'seller';

        saveDB(db);

        bot.sendMessage(chatId,
`📩 Enter seller Telegram ID`);

        return;
    }

    tx = Object.values(db.transactions)
    .find(t =>
        String(t.buyer) === String(chatId) &&
        t.step === 'seller'
    );

    if (tx) {

        const sellerId = parseInt(text);

        if (isNaN(sellerId)) {
            bot.sendMessage(chatId,
`⚠️ Invalid Telegram ID.`);
            return;
        }

        tx.seller = sellerId;

        tx.step = null;

        tx.status = 'waiting_payment';

        saveDB(db);

        bot.sendMessage(chatId,
`✅ Deal created successfully

📦 Deal ID: ${tx.id}
💰 Amount: GHS ${tx.amount}

When payment is sent,
open My Deals and tap Mark Paid.`);

        try {

            bot.sendMessage(sellerId,
`📦 New SafeTrade Deal

Deal ID: ${tx.id}
Amount: GHS ${tx.amount}

Send /start to manage the deal.`);

        } catch (err) {

            bot.sendMessage(chatId,
`⚠️ Seller could not be notified automatically.`);
        }

        return;
    }

});

console.log('✅ SafeTrade Bot Running...');