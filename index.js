const http = require('http');
http.createServer((req, res) => res.end('ok')).listen(process.env.PORT || 3000);
require('dotenv').config();
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const DB_FILE = './database.json';
const ADMIN_ID = process.env.ADMIN_ID;

/* ======================
   DB HELPERS
====================== */
function loadDB() {
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function genId() {
    return 'ST' + Math.floor(Math.random() * 1000000);
}

function findTx(db, id) {
    return db.transactions[id];
}

/* ======================
   START MENU
====================== */
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    const menu = [
        [{ text: '📝 Register', callback_data: 'register' }],
        [{ text: '💰 Create Deal', callback_data: 'create' }],
        [{ text: '📦 My Deals', callback_data: 'mytx' }],
        [{ text: '💳 Paid', callback_data: 'paid' }],
        [{ text: '🚚 Shipped', callback_data: 'shipped' }],
        [{ text: '🔓 Release', callback_data: 'release' }],
        [{ text: '🚨 Dispute', callback_data: 'dispute' }]
    ];

    if (chatId == ADMIN_ID) {
        menu.push([{ text: '🛠 Admin Panel', callback_data: 'admin' }]);
    }

    bot.sendMessage(chatId,
`🔒 SafeTrade Escrow System`,
        {
            reply_markup: {
                inline_keyboard: menu
            }
        }
    );
});

/* ======================
   CALLBACK HANDLER
====================== */
bot.on('callback_query', (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    let db = loadDB();
    if (!db.users) db.users = {};
    if (!db.transactions) db.transactions = {};

    const user = db.users[chatId];

    /* ======================
       USER ACTION MODE
    ====================== */
    if (['paid', 'shipped', 'release', 'dispute'].includes(data)) {
        db.users[chatId] = db.users[chatId] || {};
        db.users[chatId].action = data;

        saveDB(db);

        bot.sendMessage(chatId, 'Enter Transaction ID:');
    }

    /* ======================
       REGISTER
    ====================== */
    if (data === 'register') {
        db.users[chatId] = { step: 'name', trust: 'new' };
        saveDB(db);

        bot.sendMessage(chatId, 'Enter your full name.');
    }

    /* ======================
       CREATE DEAL
    ====================== */
    if (data === 'create') {
        const id = genId();

        db.transactions[id] = {
            id,
            buyer: chatId,
            step: 'amount',
            status: 'pending_payment'
        };

        saveDB(db);

        bot.sendMessage(chatId, `Enter amount (ID: ${id})`);
    }

    /* ======================
       MY DEALS
    ====================== */
    if (data === 'mytx') {
        const txs = Object.values(db.transactions)
            .filter(t => t.buyer == chatId || t.seller == chatId);

        if (!txs.length) {
            bot.sendMessage(chatId, 'No transactions found.');
        } else {
            txs.forEach(t => {
                bot.sendMessage(chatId,
`📦 ${t.id}
Status: ${t.status}
Amount: ${t.amount || 'N/A'}
Seller: ${t.seller || 'N/A'}`
                );
            });
        }
    }

    /* ======================
       ADMIN PANEL
    ====================== */
    if (data === 'admin' && chatId == ADMIN_ID) {
        const allTx = Object.values(db.transactions);

        const disputed = allTx.filter(t => t.status === 'disputed');

        bot.sendMessage(chatId,
`🛠 ADMIN PANEL

Total Transactions: ${allTx.length}
Disputed: ${disputed.length}

Commands:
- Send TX ID + "force" to release
- Send TX ID + "ban" to ban seller`
        );
    }

    bot.answerCallbackQuery(q.id);
});

/* ======================
   MESSAGE HANDLER
====================== */
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    let db = loadDB();
    if (!db.users) db.users = {};
    if (!db.transactions) db.transactions = {};

    const user = db.users[chatId];

    /* ======================
       ADMIN COMMANDS
    ====================== */
    if (chatId == ADMIN_ID) {
        const parts = text.split(' ');
        const txId = parts[0];
        const cmd = parts[1];

        const tx = findTx(db, txId);

        if (tx && cmd === 'force') {
            tx.status = 'completed';
            saveDB(db);

            bot.sendMessage(chatId, `🔓 Forced release: ${txId}`);
            return;
        }

        if (tx && cmd === 'ban') {
            if (!db.users[tx.seller]) {
                db.users[tx.seller] = {};
            }

            db.users[tx.seller].banned = true;
            saveDB(db);

            bot.sendMessage(chatId, `🚫 User banned: ${tx.seller}`);
            return;
        }
    }

    /* ======================
       REGISTER FLOW
    ====================== */
    if (user?.step === 'name') {
        user.name = text;
        user.step = 'done';

        saveDB(db);
        bot.sendMessage(chatId, `✅ Registered as ${text}`);
        return;
    }

    /* ======================
       ESCROW ACTION FLOW
    ====================== */
    if (user?.action) {
        const tx = findTx(db, text);

        if (!tx) return bot.sendMessage(chatId, 'Transaction not found.');

        if (user.action === 'paid') {
            tx.status = 'paid';
        }

        if (user.action === 'shipped') {
            tx.status = 'shipped';

            setTimeout(() => {
                let db2 = loadDB();
                let t = db2.transactions[tx.id];

                if (t && t.status === 'shipped') {
                    t.status = 'completed';

                    saveDB(db2);

                    bot.sendMessage(t.buyer, `🔓 Auto-completed: ${t.id}`);
                    bot.sendMessage(t.seller, `💰 Paid automatically: ${t.id}`);
                }
            }, 10 * 60 * 1000);
        }

        if (user.action === 'release') {
            tx.status = 'completed';
        }

        if (user.action === 'dispute') {
            tx.status = 'disputed';
        }

        delete user.action;
        saveDB(db);

        bot.sendMessage(chatId, `✅ Updated: ${tx.id}`);
        return;
    }

    /* ======================
       TRANSACTION FLOW
    ====================== */
    let tx = Object.values(db.transactions)
        .find(t => t.buyer == chatId && t.step === 'amount');

    if (tx) {
        tx.amount = text;
        tx.step = 'seller';

        saveDB(db);
        bot.sendMessage(chatId, 'Enter seller username.');
        return;
    }

    tx = Object.values(db.transactions)
        .find(t => t.buyer == chatId && t.step === 'seller');

    if (tx) {
        tx.seller = text;
        tx.step = 'waiting_payment';

        saveDB(db);

        bot.sendMessage(chatId,
`📦 Deal Created

ID: ${tx.id}
Amount: GHS ${tx.amount}
Seller: ${tx.seller}
Status: WAITING PAYMENT`
        );
        return;
    }
});