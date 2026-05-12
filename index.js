const http = require('http');
http.createServer((req, res) => res.end('ok')).listen(process.env.PORT || 3000);
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

/* ======================
   STARTUP GUARDS
====================== */
if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN env var not set');
if (!process.env.ADMIN_ID) throw new Error('ADMIN_ID env var not set');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const DB_FILE = './database.json';
const ADMIN_ID = String(process.env.ADMIN_ID);

/* ======================
   KEEP-ALIVE HTTP SERVER
====================== */
http.createServer((req, res) => res.end('ok')).listen(process.env.PORT || 3000);

/* ======================
   DB HELPERS
====================== */
function loadDB() {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const db = JSON.parse(raw);
        if (!db.users) db.users = {};
        if (!db.transactions) db.transactions = {};
        return db;
    } catch (e) {
        console.error('Failed to load DB, starting fresh:', e.message);
        return { users: {}, transactions: {} };
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to save DB:', e.message);
    }
}

function genId() {
    return 'ST' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
}

function findTx(db, id) {
    return db.transactions[id] || null;
}

function isAdmin(chatId) {
    return String(chatId) === ADMIN_ID;
}

/* ======================
   START / CANCEL
====================== */
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const db = loadDB();

    // Clear any stuck state
    if (db.users[chatId]) {
        delete db.users[chatId].action;
        delete db.users[chatId].step;
        saveDB(db);
    }

    const menu = [
        [{ text: '📝 Register', callback_data: 'register' }],
        [{ text: '💰 Create Deal', callback_data: 'create' }],
        [{ text: '📦 My Deals', callback_data: 'mytx' }],
        [{ text: '💳 Paid', callback_data: 'paid' }],
        [{ text: '🚚 Shipped', callback_data: 'shipped' }],
        [{ text: '🔓 Release', callback_data: 'release' }],
        [{ text: '🚨 Dispute', callback_data: 'dispute' }]
    ];

    if (isAdmin(chatId)) {
        menu.push([{ text: '🛠 Admin Panel', callback_data: 'admin' }]);
    }

    bot.sendMessage(chatId, '🔒 SafeTrade Escrow System\n\nSend /cancel at any time to reset.', {
        reply_markup: { inline_keyboard: menu }
    });
});

bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const db = loadDB();

    if (db.users[chatId]) {
        delete db.users[chatId].action;
        delete db.users[chatId].step;
        saveDB(db);
    }

    bot.sendMessage(chatId, '❌ Action cancelled. Send /start to return to the menu.');
});

/* ======================
   CALLBACK HANDLER
====================== */
bot.on('callback_query', (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    const db = loadDB();

    /* ======================
       USER ACTION MODE
    ====================== */
    if (['paid', 'shipped', 'release', 'dispute'].includes(data)) {
        db.users[chatId] = db.users[chatId] || {};
        db.users[chatId].action = data;
        saveDB(db);
        bot.sendMessage(chatId, 'Enter Transaction ID (or /cancel to abort):');
    }

    /* ======================
       REGISTER
    ====================== */
    if (data === 'register') {
        db.users[chatId] = db.users[chatId] || {};
        db.users[chatId].step = 'name';
        saveDB(db);
        bot.sendMessage(chatId, 'Enter your full name (or /cancel to abort):');
    }

    /* ======================
       CREATE DEAL
    ====================== */
    if (data === 'create') {
        const db2 = loadDB();
        const user = db2.users[chatId];

        if (!user || !user.name) {
            bot.sendMessage(chatId, '⚠️ Please register first before creating a deal.');
            bot.answerCallbackQuery(q.id);
            return;
        }

        const id = genId();
        db2.transactions[id] = {
            id,
            buyer: chatId,
            buyerName: user.name,
            step: 'amount',
            status: 'pending_payment',
            createdAt: Date.now()
        };
        saveDB(db2);
        bot.sendMessage(chatId, `💰 New deal started.\nYour Deal ID: <code>${id}</code>\n\nEnter the amount in GHS (or /cancel to abort):`, { parse_mode: 'HTML' });
    }

    /* ======================
       MY DEALS
    ====================== */
    if (data === 'mytx') {
        const db2 = loadDB();
        const txs = Object.values(db2.transactions)
            .filter(t => String(t.buyer) === String(chatId) || String(t.seller) === String(chatId));

        if (!txs.length) {
            bot.sendMessage(chatId, 'No transactions found.');
        } else {
            txs.forEach(t => {
                const role = String(t.buyer) === String(chatId) ? 'Buyer' : 'Seller';
                bot.sendMessage(chatId,
`📦 <code>${t.id}</code>
Role: ${role}
Status: ${t.status}
Amount: GHS ${t.amount || 'N/A'}
Seller: ${t.sellerName || t.seller || 'N/A'}`,
                    { parse_mode: 'HTML' }
                );
            });
        }
    }

    /* ======================
       ADMIN PANEL
    ====================== */
    if (data === 'admin' && isAdmin(chatId)) {
        const db2 = loadDB();
        const allTx = Object.values(db2.transactions);
        const disputed = allTx.filter(t => t.status === 'disputed');
        const completed = allTx.filter(t => t.status === 'completed');

        bot.sendMessage(chatId,
`🛠 <b>ADMIN PANEL</b>

Total Transactions: ${allTx.length}
Completed: ${completed.length}
Disputed: ${disputed.length}

<b>Commands:</b>
<code>TXID force</code> — force release funds
<code>TXID ban</code> — ban the seller on that deal
<code>TXID refund</code> — mark as refunded`,
            { parse_mode: 'HTML' }
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

    if (!text || text.startsWith('/')) return;

    const db = loadDB();
    const user = db.users[chatId];

    /* ======================
       ADMIN COMMANDS
    ====================== */
    if (isAdmin(chatId)) {
        const parts = text.trim().split(' ');
        const txId = parts[0];
        const cmd = parts[1];
        const tx = findTx(db, txId);

        if (tx && cmd === 'force') {
            tx.status = 'completed';
            saveDB(db);
            bot.sendMessage(chatId, `🔓 Forced release: <code>${txId}</code>`, { parse_mode: 'HTML' });
            if (tx.seller) bot.sendMessage(tx.seller, `💰 Payment released for deal <code>${tx.id}</code>`, { parse_mode: 'HTML' });
            return;
        }

        if (tx && cmd === 'ban') {
            // Ban by numeric seller chat ID, not username string
            const sellerId = tx.seller;
            if (sellerId) {
                db.users[sellerId] = db.users[sellerId] || {};
                db.users[sellerId].banned = true;
                saveDB(db);
                bot.sendMessage(chatId, `🚫 Seller banned (ID: ${sellerId})`);
            } else {
                bot.sendMessage(chatId, '⚠️ No seller linked to this deal yet.');
            }
            return;
        }

        if (tx && cmd === 'refund') {
            tx.status = 'refunded';
            saveDB(db);
            bot.sendMessage(chatId, `↩️ Marked as refunded: <code>${txId}</code>`, { parse_mode: 'HTML' });
            if (tx.buyer) bot.sendMessage(tx.buyer, `↩️ Deal <code>${tx.id}</code> has been refunded by admin.`, { parse_mode: 'HTML' });
            return;
        }
    }

    /* ======================
       BANNED CHECK
    ====================== */
    if (user?.banned) {
        bot.sendMessage(chatId, '🚫 Your account has been banned.');
        return;
    }

    /* ======================
       REGISTER FLOW
    ====================== */
    if (user?.step === 'name') {
        if (text.length > 100) {
            bot.sendMessage(chatId, '⚠️ Name too long. Please enter a shorter name.');
            return;
        }
        user.name = text.trim();
        user.step = 'done';
        saveDB(db);
        bot.sendMessage(chatId, `✅ Registered as <b>${user.name}</b>`, { parse_mode: 'HTML' });
        return;
    }

    /* ======================
       ESCROW ACTION FLOW
    ====================== */
    if (user?.action) {
        const tx = findTx(db, text.trim());

        if (!tx) {
            // Clear stuck action state
            delete user.action;
            saveDB(db);
            bot.sendMessage(chatId, '❌ Transaction not found. Action cancelled. Send /start to try again.');
            return;
        }

        const isParty = String(tx.buyer) === String(chatId) || String(tx.seller) === String(chatId);

        if (!isParty) {
            delete user.action;
            saveDB(db);
            bot.sendMessage(chatId, '⛔ You are not a party to this transaction.');
            return;
        }

        if (user.action === 'paid') {
            if (String(tx.buyer) !== String(chatId)) {
                delete user.action;
                saveDB(db);
                bot.sendMessage(chatId, '⛔ Only the buyer can mark a deal as paid.');
                return;
            }
            tx.status = 'paid';
            // Notify seller
            if (tx.seller) {
                bot.sendMessage(tx.seller, `💳 Buyer has marked deal <code>${tx.id}</code> as paid. Please ship the item.`, { parse_mode: 'HTML' });
            }
        }

        if (user.action === 'shipped') {
            if (String(tx.seller) !== String(chatId)) {
                delete user.action;
                saveDB(db);
                bot.sendMessage(chatId, '⛔ Only the seller can mark a deal as shipped.');
                return;
            }
            tx.status = 'shipped';

            // Auto-complete after 10 minutes if not disputed
            const txId = tx.id;
            setTimeout(() => {
                const db2 = loadDB();
                const t = db2.transactions[txId];
                if (t && t.status === 'shipped') {
                    t.status = 'completed';
                    saveDB(db2);
                    bot.sendMessage(t.buyer, `🔓 Deal <code>${t.id}</code> auto-completed. Funds released to seller.`, { parse_mode: 'HTML' });
                    if (t.seller) bot.sendMessage(t.seller, `💰 Deal <code>${t.id}</code> auto-completed. Payment released.`, { parse_mode: 'HTML' });
                }
            }, 10 * 60 * 1000);

            // Notify buyer
            bot.sendMessage(tx.buyer, `🚚 Seller has shipped deal <code>${tx.id}</code>. Funds will auto-release in 10 minutes unless you dispute.`, { parse_mode: 'HTML' });
        }

        if (user.action === 'release') {
            if (String(tx.buyer) !== String(chatId)) {
                delete user.action;
                saveDB(db);
                bot.sendMessage(chatId, '⛔ Only the buyer can release funds.');
                return;
            }
            tx.status = 'completed';
            if (tx.seller) bot.sendMessage(tx.seller, `💰 Buyer released funds for deal <code>${tx.id}</code>.`, { parse_mode: 'HTML' });
        }

        if (user.action === 'dispute') {
            tx.status = 'disputed';
            // Notify admin
            bot.sendMessage(ADMIN_ID,
`🚨 <b>DISPUTE RAISED</b>

Deal: <code>${tx.id}</code>
Amount: GHS ${tx.amount}
Buyer: ${tx.buyer}
Seller: ${tx.seller || 'N/A'}

Reply with: <code>${tx.id} force</code> or <code>${tx.id} refund</code>`,
                { parse_mode: 'HTML' }
            );
        }

        delete user.action;
        saveDB(db);
        bot.sendMessage(chatId, `✅ Updated: <code>${tx.id}</code> → <b>${tx.status}</b>`, { parse_mode: 'HTML' });
        return;
    }

    /* ======================
       TRANSACTION FLOW
    ====================== */
    let tx = Object.values(db.transactions)
        .find(t => String(t.buyer) === String(chatId) && t.step === 'amount');

    if (tx) {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) {
            bot.sendMessage(chatId, '⚠️ Please enter a valid amount (numbers only, e.g. 150).');
            return;
        }
        tx.amount = amount;
        tx.step = 'seller_id';
        saveDB(db);
        bot.sendMessage(chatId, `Amount set: GHS ${amount}\n\nNow ask the seller to send you their Telegram ID.\nThey can get it by messaging @userinfobot.\n\nEnter the seller's numeric Telegram ID:`);
        return;
    }

    tx = Object.values(db.transactions)
        .find(t => String(t.buyer) === String(chatId) && t.step === 'seller_id');

    if (tx) {
        const sellerId = parseInt(text.trim());
        if (isNaN(sellerId)) {
            bot.sendMessage(chatId, '⚠️ Please enter a valid numeric Telegram ID.');
            return;
        }
        if (String(sellerId) === String(chatId)) {
            bot.sendMessage(chatId, '⚠️ You cannot be both buyer and seller.');
            return;
        }

        // Check if seller is banned
        if (db.users[sellerId]?.banned) {
            bot.sendMessage(chatId, '🚫 That seller account is banned.');
            return;
        }

        tx.seller = sellerId;
        tx.sellerName = db.users[sellerId]?.name || 'Unknown';
        tx.step = 'waiting_payment';
        tx.status = 'waiting_payment';
        saveDB(db);

        const summary =
`📦 <b>Deal Created</b>

ID: <code>${tx.id}</code>
Amount: GHS ${tx.amount}
Buyer: ${db.users[chatId]?.name || chatId}
Seller ID: ${sellerId}
Status: WAITING PAYMENT`;

        bot.sendMessage(chatId, summary, { parse_mode: 'HTML' });

        // Notify seller
        try {
            bot.sendMessage(sellerId,
`📦 <b>New Escrow Deal</b>

Deal ID: <code>${tx.id}</code>
Amount: GHS ${tx.amount}
Buyer: ${db.users[chatId]?.name || 'Unknown'}

You have been added as the seller. Use /start to manage this deal.`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            bot.sendMessage(chatId, '⚠️ Could not notify the seller automatically. Please share the Deal ID with them manually.');
        }
        return;
    }
});
