// ─────────────────────────────────────────────────────────────────────────────
//  tls.js  –  TLS setup for the Royal DNS server (single domain, custom port)
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHY A SEPARATE FUNCTION:
//  Cert issuance/renewal is its own concern from the request-handling code in
//  doh-server.js. Keeping it here means you can call ensureCertificate() on
//  its own (e.g. from setup.sh, or a cron job) without booting the whole
//  server, and unit-test it in isolation.
//
//  This issues a REGULAR (non-wildcard) Let's Encrypt certificate for a
//  single hostname, e.g. dns.royalgaming.com. There is no per-customer
//  subdomain — every customer hits the SAME hostname:port, and what tells
//  them apart is the unique key in the URL PATH:
//
//    https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w
//
//  Since it's a single hostname (not a wildcard), the simple HTTP-01
//  challenge works fine — no DNS provider API needed.
//
//  PREREQUISITES:
//    npm install acme-client
//    Port 80 reachable from the internet (used only during issuance/
//    renewal, to answer the ACME http-01 challenge).
//
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const http = require('http');
const acme = require('acme-client');
require('dotenv').config(); // loads .env written by setup.sh

const CERT_DIR = path.join(__dirname, 'certs');
const DOMAIN   = process.env.DNS_DOMAIN;

if (!DOMAIN) {
    throw new Error('DNS_DOMAIN is not set — run setup.sh first, or set it in .env');
}

/**
 * Usage: call once at boot (and again on a daily cron/timer) to make sure a
 * valid, non-expiring-soon certificate exists on disk before the server
 * starts listening. Returns the paths to the key/cert files.
 *
 *   const { keyPath, certPath } = await ensureCertificate();
 */
async function ensureCertificate() {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

    const keyPath  = path.join(CERT_DIR, 'privkey.pem');
    const certPath = path.join(CERT_DIR, 'fullchain.pem');

    if (fs.existsSync(certPath) && !isExpiringSoon(certPath, 14)) {
        console.log('✅ Existing certificate is still valid, skipping renewal');
        return { keyPath, certPath };
    }

    console.log(`⚡ Requesting/renewing TLS certificate for ${DOMAIN} via ACME...`);

    const accountKey = await acme.forge.createPrivateKey();
    const client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey
    });

    const [certKey, csr] = await acme.forge.createCsr({ commonName: DOMAIN });

    const cert = await client.auto({
        csr,
        email: 'admin@royalgaming.com',
        termsOfServiceAgreed: true,
        challengePriority: ['http-01'],
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
            const stop = await serveHttpChallenge(challenge.token, keyAuthorization);
            stopChallengeServers.push(stop);
        },
        challengeRemoveFn: async () => {
            let stop;
            while ((stop = stopChallengeServers.pop())) stop();
        }
    });

    fs.writeFileSync(keyPath, certKey);
    fs.writeFileSync(certPath, cert);
    console.log('✅ Certificate issued and saved to', CERT_DIR);

    return { keyPath, certPath };
}

// Tracks the temporary challenge server(s) started during issuance so
// challengeRemoveFn can tear them down. Internal to this module only.
const stopChallengeServers = [];

/**
 * Usage: pass a cert file path, get back whether it expires within
 * thresholdDays. Called internally by ensureCertificate(); exported so a
 * monitoring script can check without re-requesting a cert.
 *
 *   if (isExpiringSoon('/path/to/fullchain.pem', 14)) { ... }
 */
function isExpiringSoon(certPath, thresholdDays = 14) {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const cert = new (require('crypto').X509Certificate)(certPem);
    const expiryMs = new Date(cert.validTo).getTime();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    return (expiryMs - Date.now()) < thresholdMs;
}

/**
 * Usage: builds the options object passed to https.createServer.
 * Call this AFTER ensureCertificate() has run at least once.
 *
 *   const options = await buildTlsOptions();
 *   https.createServer(options, app).listen(DOH_PORT);
 */
async function buildTlsOptions() {
    const { keyPath, certPath } = await ensureCertificate();
    return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        // Force modern TLS only — gaming/DNS clients don't need legacy support.
        minVersion: 'TLSv1.2'
    };
}

/**
 * Usage: internal — starts a bare HTTP server on port 80 that answers the
 * ACME http-01 challenge path, and returns a function to stop it. Only runs
 * for the ~seconds it takes to validate. Requires port 80 to be free and
 * reachable from the internet (setup.sh opens it in the firewall).
 *
 *   const stop = await serveHttpChallenge(token, keyAuthorization);
 *   // ...validate...
 *   stop();
 */
function serveHttpChallenge(token, keyAuthorization) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === `/.well-known/acme-challenge/${token}`) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(keyAuthorization);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(80, () => resolve(() => server.close()));
    });
}

module.exports = { ensureCertificate, buildTlsOptions, isExpiringSoon };
