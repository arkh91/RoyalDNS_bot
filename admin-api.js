// ─────────────────────────────────────────────────────────────────────────────
//  admin-api.js  –  Remote key management API for this regional VPS
// ─────────────────────────────────────────────────────────────────────────────
//
//  This is what the Telegram bot (on the main VPS) calls to create/remove
//  keys on THIS regional server, instead of you SSHing in and running
//  manage-keys.js by hand. Same underlying keys.js functions either way —
//  this is just an authenticated HTTP door onto them.
//
//  Runs as its own process/port, separate from doh-server.js (customer
//  traffic) and separate from the bot (which lives on the main VPS only).
//
//  npm install express https
//
// ─────────────────────────────────────────────────────────────────────────────

const crypto  = require('crypto');
const express = require('express');
const https   = require('https');
const { buildTlsOptions } = require('./tls');
const keys = require('./keys');
require('dotenv').config(); // loads .env written by setup.sh (ADMIN_TOKEN, ADMIN_PORT)

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const ADMIN_PORT  = process.env.ADMIN_PORT || 9443;

if (!ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN is not set — run setup.sh first, or set it in .env');
}

const app = express();
app.use(express.json());

/**
 * Usage: internal Express middleware — checks the Authorization header
 * against ADMIN_TOKEN using a constant-time comparison (crypto.timingSafeEqual)
 * so response timing can't leak how much of the token guess was correct.
 * Applied to every route below except /health. Not exported.
 */
function requireBearerToken(req, res, next) {
    const header = req.get('Authorization') || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const expected = Buffer.from(ADMIN_TOKEN);
    const provided = Buffer.from(token);

    // timingSafeEqual throws if lengths differ, so guard that first —
    // still constant-time from an attacker's perspective either way.
    const valid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

    if (!valid) {
        console.warn(`❌ Rejected admin API request — bad token from ${req.ip}`);
        return res.status(401).json({ error: 'Invalid token' });
    }
    next();
}

/**
 * Usage: internal — logs every request this API receives (method, path,
 * caller IP) to stdout, which systemd sends to the journal
 * (journalctl -u royaldns-admin -f). Applied to all routes.
 */
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} from ${req.ip}`);
    next();
});

/**
 * Usage: unauthenticated health check for uptime monitors.
 *
 *   curl https://us.us08dir.mithracorp.com:9443/health
 */
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/**
 * Usage: the main VPS bot calls this after a successful payment. Body must
 * be JSON: { "telegramId": 123456789, "days": 30 }. Returns the same shape
 * keys.createKey() returns — key, expiresAt, dohUrl.
 *
 *   curl -X POST https://us.us08dir.mithracorp.com:9443/create \
 *     -H "Authorization: Bearer <token>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"telegramId": 123456789, "days": 30}'
 */
app.post('/create', requireBearerToken, async (req, res) => {
    const { telegramId, days } = req.body || {};

    if (!telegramId || !days) {
        return res.status(400).json({ error: 'telegramId and days are required' });
    }

    try {
        const issued = await keys.createKey(Number(telegramId), Number(days));
        res.json(issued);
    } catch (err) {
        console.error('Create key error:', err.message);
        res.status(500).json({ error: 'Failed to create key' });
    }
});

/**
 * Usage: the main VPS bot calls this on cancellation/refund/abuse. Body must
 * be JSON: { "key": "a1A10A4qQmNCh3GgcL0e2w", "hard": false }. "hard" is
 * optional (defaults to a soft revoke). Tolerates a pasted-in full URL or
 * leading slash the same way manage-keys.js does. Returns 404 if the key
 * doesn't exist, so callers can tell "removed" from "already gone".
 *
 *   curl -X POST https://us.us08dir.mithracorp.com:9443/remove \
 *     -H "Authorization: Bearer <token>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"key": "a1A10A4qQmNCh3GgcL0e2w"}'
 */
app.post('/remove', requireBearerToken, async (req, res) => {
    const { key, hard } = req.body || {};

    if (!key) {
        return res.status(400).json({ error: 'key is required' });
    }

    const cleanKey = String(key).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');

    try {
        const removed = await keys.removeKey(cleanKey, Boolean(hard));
        if (!removed) {
            return res.status(404).json({ error: 'No matching key found', key: cleanKey });
        }
        res.json({ removed: true, key: cleanKey, hard: Boolean(hard) });
    } catch (err) {
        console.error('Remove key error:', err.message);
        res.status(500).json({ error: 'Failed to remove key' });
    }
});

/**
 * Usage: lists every key on this server with its computed status
 * (active/expired/revoked) — useful for the main VPS to reconcile its own
 * records against what a regional server actually has.
 *
 *   curl https://us.us08dir.mithracorp.com:9443/list \
 *     -H "Authorization: Bearer <token>"
 */
app.get('/list', requireBearerToken, async (req, res) => {
    try {
        const rows = await keys.listKeys();
        res.json(rows);
    } catch (err) {
        console.error('List keys error:', err.message);
        res.status(500).json({ error: 'Failed to list keys' });
    }
});

/**
 * Usage: entry point — call this once to start listening. Kept separate
 * from top-level code so it can be imported without starting (e.g. tests).
 *
 *   if (require.main === module) startServer();
 */
async function startServer() {
    const tlsOptions = await buildTlsOptions();
    https.createServer(tlsOptions, app).listen(ADMIN_PORT, () => {
        console.log(`✅ Admin API listening on :${ADMIN_PORT}`);
    });
}

if (require.main === module) {
    startServer().catch((err) => {
        console.error('❌ Failed to start admin API:', err);
        process.exit(1);
    });
}

module.exports = { app, startServer };
