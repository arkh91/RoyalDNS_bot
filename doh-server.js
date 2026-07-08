// ─────────────────────────────────────────────────────────────────────────────
//  doh-server.js  –  DNS-over-HTTPS endpoint, gated by customer keys
// ─────────────────────────────────────────────────────────────────────────────
//
//  Run this as its own process (pm2/systemd), separate from the Telegram bot.
//  It listens on 443, checks the caller's key, then forwards the raw DNS
//  wire-format query to an upstream resolver (Cloudflare here — swap for
//  your own filtering resolver if you have one).
//
//  npm install express https axios
//
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const https   = require('https');
const axios   = require('axios');
const { buildTlsOptions } = require('./tls');
const { isKeyValid } = require('./keys');
require('dotenv').config(); // loads .env written by setup.sh (DNS_DOMAIN, DOH_PORT, DB_*)

const UPSTREAM_DOH = 'https://cloudflare-dns.com/dns-query';
const DOH_PORT = process.env.DOH_PORT || 443;

const app = express();
app.use(express.raw({ type: 'application/dns-message', limit: '8kb' }));

/**
 * Usage: simple unauthenticated health check for uptime monitors / load
 * balancers. Deliberately does NOT touch the key table. Registered BEFORE
 * the /:key route below, since Express matches routes in declaration order
 * and "/health" would otherwise be swallowed by the single-segment :key
 * wildcard.
 *
 *   curl https://dns.royalgaming.com:11111/health
 */
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/**
 * Usage: this is the actual DoH route clients hit — the key lives in the
 * URL PATH, e.g. https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w,
 * which is what you hand a customer and what they paste into Intra's custom
 * server field. Not called directly by other code — Express wires it up
 * when the server starts. Handles both GET (?dns=<base64>) and POST (raw
 * wire-format body) per the DoH spec (RFC 8484).
 */
app.all('/:key', async (req, res) => {
    const key = req.params.key;

    if (!key || !(await isKeyValid(key))) {
        console.warn(`❌ Rejected DoH query — invalid/expired key: ${key}`);
        return res.status(403).json({ error: 'Invalid or expired DNS key' });
    }

    try {
        const upstreamResponse = await axios({
            method: req.method,
            url: UPSTREAM_DOH,
            params: req.method === 'GET' ? { dns: req.query.dns } : undefined,
            data: req.method === 'POST' ? req.body : undefined,
            headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
            responseType: 'arraybuffer'
        });
        res.set('Content-Type', 'application/dns-message');
        res.send(Buffer.from(upstreamResponse.data));
    } catch (err) {
        console.error('Upstream DoH error:', err.message);
        res.status(502).json({ error: 'Upstream resolution failed' });
    }
});

/**
 * Usage: entry point — call this once to start listening. Kept separate from
 * top-level code so test scripts can import the server without starting it.
 * Listens on DOH_PORT (from .env, set by setup.sh) rather than a hardcoded
 * 443, since IP mode commonly uses a non-standard port.
 *
 *   if (require.main === module) startServer();
 */
async function startServer() {
    const tlsOptions = await buildTlsOptions();
    https.createServer(tlsOptions, app).listen(DOH_PORT, () => {
        console.log(`✅ DoH server listening on :${DOH_PORT}`);
    });
}

if (require.main === module) {
    startServer().catch((err) => {
        console.error('❌ Failed to start DoH server:', err);
        process.exit(1);
    });
}

module.exports = { app, startServer };
