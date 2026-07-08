// ─────────────────────────────────────────────────────────────────────────────
//  test-dns.js  –  Automated checks for the Royal DNS server
// ─────────────────────────────────────────────────────────────────────────────
//
//  Usage: node test/test-dns.js <domain> <port> <key>
//  Example: node test/test-dns.js dns.royalgaming.com 11111 a1A10A4qQmNCh3GgcL0e2w
//
//  Run this after every deploy, or wire it into a cron job / CI pipeline so
//  you find out about a broken cert or dead key-check BEFORE customers do.
//
//  npm install axios
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const tls = require('tls');

const [, , DOMAIN, PORT, KEY] = process.argv;
const SAMPLE_QUERY = 'q80BAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB'; // example.com A query, base64url

if (!DOMAIN || !PORT || !KEY) {
    console.error('Usage: node test-dns.js <domain> <port> <key>');
    process.exit(1);
}

const BASE_URL = `https://${DOMAIN}:${PORT}`;

let passed = 0;
let failed = 0;

/**
 * Usage: wraps each check so one failure doesn't stop the rest of the suite,
 * and gives consistent pass/fail output. Not exported — internal to this file.
 *
 *   await check('health endpoint responds', async () => { ...assert... });
 */
async function check(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`❌ ${name} — ${err.message}`);
        failed++;
    }
}

/**
 * Usage: entry point, runs every check in sequence and prints a summary.
 * Called automatically at the bottom of this file.
 */
async function runAll() {
    await check(`server is reachable over TLS on ${PORT}`, () =>
        new Promise((resolve, reject) => {
            const socket = tls.connect(Number(PORT), DOMAIN, { servername: DOMAIN }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', reject);
        })
    );

    await check('TLS certificate matches the domain and is not expired', () =>
        new Promise((resolve, reject) => {
            const socket = tls.connect(Number(PORT), DOMAIN, { servername: DOMAIN }, () => {
                const cert = socket.getPeerCertificate();
                socket.end();
                if (!cert || !cert.valid_to) return reject(new Error('no certificate returned'));
                if (new Date(cert.valid_to) < new Date()) return reject(new Error('certificate expired'));
                resolve();
            });
            socket.on('error', reject);
        })
    );

    await check('health endpoint returns 200', async () => {
        const res = await axios.get(`${BASE_URL}/health`);
        if (res.status !== 200) throw new Error(`got ${res.status}`);
    });

    await check('DoH query with a bogus key is rejected (403)', async () => {
        try {
            await axios.get(`${BASE_URL}/not-a-real-key`, { params: { dns: SAMPLE_QUERY } });
            throw new Error('expected 403 but request succeeded');
        } catch (err) {
            if (err.response?.status !== 403) throw new Error(`expected 403, got ${err.response?.status}`);
        }
    });

    await check('DoH query with the valid key resolves (200)', async () => {
        const res = await axios.get(`${BASE_URL}/${KEY}`, {
            params: { dns: SAMPLE_QUERY },
            responseType: 'arraybuffer'
        });
        if (res.status !== 200) throw new Error(`got ${res.status}`);
        if (res.data.length < 12) throw new Error('response too short to be a valid DNS message');
    });

    await check('average latency is under 150ms (5-request sample)', async () => {
        const times = [];
        for (let i = 0; i < 5; i++) {
            const start = Date.now();
            await axios.get(`${BASE_URL}/${KEY}`, { params: { dns: SAMPLE_QUERY } });
            times.push(Date.now() - start);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`   (avg ${avg.toFixed(0)}ms, samples: ${times.join('ms, ')}ms)`);
        if (avg > 150) throw new Error(`avg latency ${avg.toFixed(0)}ms exceeds 150ms target`);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runAll();
