// ─────────────────────────────────────────────────────────────────────────────
//  keys.js  –  Create / validate / remove customer DNS keys
// ─────────────────────────────────────────────────────────────────────────────
//
//  This is the piece that ties your Telegram bot's payment flow to the actual
//  DNS server. A "key" is a random token stored in MySQL with an expiry date.
//  Every customer connects to the SAME domain:port — the key in the URL PATH
//  is what identifies and authorizes them, e.g.:
//
//    https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w
//
//  There is no per-customer subdomain. The DNS server checks incoming
//  requests against this table on every query (see doh-server.js), and your
//  bot calls createKey/removeKey when a purchase completes or is refunded.
//
//  ASSUMES: ./db.js exports a mysql2/promise-style pool with .query() or
//  .execute() returning a Promise. Adjust the db.query(...) calls below to
//  match whatever your db.js actually exports (e.g. if it's callback-style
//  `mysql`, wrap it with util.promisify first).
//
//  Suggested table (run once):
//    CREATE TABLE dns_keys (
//      id INT AUTO_INCREMENT PRIMARY KEY,
//      key_value VARCHAR(64) UNIQUE NOT NULL,
//      telegram_id BIGINT NOT NULL,
//      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
//      expires_at DATETIME NOT NULL,
//      revoked TINYINT(1) DEFAULT 0
//    );
//
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const db = require('./db'); // your existing MySQL wrapper
require('dotenv').config(); // loads .env written by setup.sh

const DOMAIN   = process.env.DNS_DOMAIN;
const DOH_PORT = process.env.DOH_PORT || 443;

if (!DOMAIN) {
    throw new Error('DNS_DOMAIN is not set — run setup.sh first, or set it in .env');
}

/**
 * Usage: call after a successful payment to issue a brand-new key.
 * Returns the key string and the URL the customer should paste into Intra
 * (or any other DoH client that takes a custom server URL).
 *
 *   const key = await createKey(msg.from.id, 30); // 30-day key
 *   bot.sendMessage(chatId, `Your DNS key: ${key.dohUrl}`);
 */
async function createKey(telegramId, durationDays) {
    // base64url gives a mixed-case, URL-safe token, e.g. "a1A10A4qQmNCh3GgcL0e2w".
    const keyValue = crypto.randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    await db.query(
        'INSERT INTO dns_keys (key_value, telegram_id, expires_at) VALUES (?, ?, ?)',
        [keyValue, telegramId, expiresAt]
    );

    return {
        key: keyValue,
        expiresAt,
        // Path-based form: https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w
        // The key lives in the URL PATH, not a query string, so it reads as
        // a single opaque per-customer endpoint — this is what goes into
        // Intra's "Custom Server" field.
        dohUrl: `https://${DOMAIN}:${DOH_PORT}/${keyValue}`
    };
}

/**
 * Usage: call when a subscription is cancelled, refunded, or you need to
 * kill a key immediately (e.g. abuse). Soft-deletes by default so you keep
 * history; pass hardDelete=true to actually remove the row.
 *
 *   await removeKey('a1A10A4qQmNCh3GgcL0e2w');
 *   await removeKey('a1A10A4qQmNCh3GgcL0e2w', true); // permanently delete
 */
async function removeKey(keyValue, hardDelete = false) {
    if (hardDelete) {
        await db.query('DELETE FROM dns_keys WHERE key_value = ?', [keyValue]);
    } else {
        await db.query('UPDATE dns_keys SET revoked = 1 WHERE key_value = ?', [keyValue]);
    }
}

/**
 * Usage: called by the DNS server on every incoming query to decide whether
 * to resolve it or reject with an error. Returns true/false.
 *
 *   if (!(await isKeyValid(req.params.key))) return res.status(403).end();
 */
async function isKeyValid(keyValue) {
    const rows = await db.query(
        'SELECT expires_at, revoked FROM dns_keys WHERE key_value = ?',
        [keyValue]
    );
    if (!rows || rows.length === 0) return false;
    const row = rows[0];
    if (row.revoked) return false;
    return new Date(row.expires_at) > new Date();
}

/**
 * Usage: run on a daily cron to purge/flag keys that expired long ago, so
 * your table (and your "My Keys" menu) doesn't grow unbounded.
 *
 *   await purgeExpiredKeys(90); // delete keys expired more than 90 days ago
 */
async function purgeExpiredKeys(graceDays = 90) {
    await db.query(
        'DELETE FROM dns_keys WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [graceDays]
    );
}

module.exports = { createKey, removeKey, isKeyValid, purgeExpiredKeys };
