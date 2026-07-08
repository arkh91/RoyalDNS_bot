// ─────────────────────────────────────────────────────────────────────────────
//  keys.js  –  Create / validate / remove customer DNS keys (FILE-BASED)
// ─────────────────────────────────────────────────────────────────────────────
//
//  This regional server has NO database — every key lives in a single JSON
//  file on disk (keys-data.json). That's a deliberate choice: DNS query
//  volume here is low enough that a file read per query is cheap, and it
//  means this box has zero database attack surface and nothing to keep
//  patched/secured beyond the OS itself. The ONE central database in this
//  whole system lives on the main VPS, for its own bookkeeping — this file
//  is the actual source of truth for whether a key is valid, right here on
//  the box that's serving DNS queries.
//
//  Every function below re-reads the file fresh rather than caching in
//  memory, since doh-server.js, admin-api.js, and manage-keys.js are all
//  SEPARATE processes that touch the same file — an in-memory cache in one
//  process wouldn't see changes made by another. Writes are serialized
//  within this process via a simple promise-chain lock (writeQueue) and use
//  a write-to-temp-then-rename pattern so a crash mid-write can't corrupt
//  the file. Cross-process write races (e.g. manage-keys.js and admin-api.js
//  writing at the exact same instant) aren't fully guarded against — a real
//  risk only under concurrent admin operations, not DNS query volume.
//
//  Suggested reading if you ever outgrow this: the moment regional write
//  volume gets meaningful, look at SQLite (still a single file, but handles
//  concurrent writers safely) before reaching back for a full DB server.
//
// ─────────────────────────────────────────────────────────────────────────────

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
require('dotenv').config(); // loads .env written by setup.sh

const DOMAIN   = process.env.DNS_DOMAIN;
const DOH_PORT = process.env.DOH_PORT || 443;

if (!DOMAIN) {
    throw new Error('DNS_DOMAIN is not set — run setup.sh first, or set it in .env');
}

const DATA_DIR   = path.join(__dirname, 'data');
const KEYS_FILE  = path.join(DATA_DIR, 'keys-data.json');

// Serializes the ENTIRE read-modify-write cycle within this process, not
// just the write — locking only the write step still lets two concurrent
// calls both read the same stale snapshot and clobber each other's changes.
let writeQueue = Promise.resolve();

/**
 * Usage: internal — reads the current keys file, returning {} if it
 * doesn't exist yet (first run). Not exported; only called from inside
 * withKeysFile() below, never on its own, so reads stay inside the lock.
 *
 *   const allKeys = readKeysFile();
 */
function readKeysFile() {
    if (!fs.existsSync(KEYS_FILE)) return {};
    const raw = fs.readFileSync(KEYS_FILE, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
}

/**
 * Usage: internal — writes atomically (temp file + rename) so a crash
 * mid-write leaves the old file intact rather than a truncated one. Only
 * ever called from inside withKeysFile(), already holding the lock.
 *
 *   writeKeysFileSync(updatedKeysObject);
 */
function writeKeysFileSync(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${KEYS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, KEYS_FILE);
}

/**
 * Usage: internal — the ONLY way any function below touches the file.
 * Queues read+mutate+write as one atomic unit against a process-wide chain,
 * so concurrent createKey/removeKey/purgeExpiredKeys calls can't interleave
 * and lose each other's changes (this is the fix for a real bug: locking
 * only the write step still let two concurrent reads see the same stale
 * snapshot). `mutatorFn(allKeys)` mutates the object in place and returns
 * whatever the caller should get back.
 *
 *   const result = await withKeysFile((allKeys) => {
 *       allKeys[newKey] = { ... };
 *       return { key: newKey };
 *   });
 */
function withKeysFile(mutatorFn) {
    const task = writeQueue.then(() => {
        const allKeys = readKeysFile();
        const result = mutatorFn(allKeys);
        writeKeysFileSync(allKeys);
        return result;
    });
    // Keep the queue moving even if this task threw — swallow here so a
    // failed operation doesn't jam every future one, but the caller still
    // sees their own rejection via `task` (returned below, not `writeQueue`).
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
}

/**
 * Usage: call after a successful payment to issue a brand-new key. Returns
 * the key string and the URL the customer should paste into Intra.
 *
 *   const issued = await createKey(123456789, 30); // 30-day key
 *   console.log(issued.dohUrl);
 */
async function createKey(telegramId, durationDays) {
    const keyValue = crypto.randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    await withKeysFile((allKeys) => {
        allKeys[keyValue] = {
            telegramId,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            revoked: false
        };
    });

    return {
        key: keyValue,
        expiresAt,
        dohUrl: `https://${DOMAIN}:${DOH_PORT}/${keyValue}`
    };
}

/**
 * Usage: call when a subscription is cancelled, refunded, or you need to
 * kill a key immediately. Soft-deletes by default so you keep history;
 * pass hardDelete=true to actually remove the entry. Returns true if a key
 * was actually found and changed, false if nothing matched.
 *
 *   const removed = await removeKey('a1A10A4qQmNCh3GgcL0e2w');
 */
async function removeKey(keyValue, hardDelete = false) {
    return withKeysFile((allKeys) => {
        if (!allKeys[keyValue]) return false;
        if (hardDelete) {
            delete allKeys[keyValue];
        } else {
            allKeys[keyValue].revoked = true;
        }
        return true;
    });
}

/**
 * Usage: called by the DNS server on every incoming query to decide whether
 * to resolve it or reject with an error. Returns true/false. Reads directly
 * rather than going through withKeysFile's queue — this runs on every DNS
 * query and shouldn't wait behind admin operations, and a plain read is
 * safe here since writeKeysFileSync's temp-file-then-rename means a
 * concurrent read only ever sees a fully old or fully new file, never a
 * torn one.
 *
 *   if (!(await isKeyValid(req.params.key))) return res.status(403).end();
 */
async function isKeyValid(keyValue) {
    const allKeys = readKeysFile();
    const entry = allKeys[keyValue];
    if (!entry || entry.revoked) return false;
    return new Date(entry.expiresAt) > new Date();
}

/**
 * Usage: returns every key with its computed status, for admin/listing use
 * (manage-keys.js's "list" command and the admin API's GET /list both call
 * this).
 *
 *   const all = await listKeys();
 */
async function listKeys() {
    const allKeys = readKeysFile();
    const now = new Date();
    return Object.entries(allKeys).map(([keyValue, entry]) => ({
        key_value: keyValue,
        telegram_id: entry.telegramId,
        created_at: entry.createdAt,
        expires_at: entry.expiresAt,
        revoked: entry.revoked,
        status: entry.revoked ? 'revoked' : new Date(entry.expiresAt) < now ? 'expired' : 'active'
    }));
}

/**
 * Usage: run on a daily cron to purge keys that expired long ago, so the
 * file doesn't grow unbounded.
 *
 *   await purgeExpiredKeys(90); // delete keys expired more than 90 days ago
 */
async function purgeExpiredKeys(graceDays = 90) {
    await withKeysFile((allKeys) => {
        const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;
        for (const [keyValue, entry] of Object.entries(allKeys)) {
            if (new Date(entry.expiresAt).getTime() < cutoff) {
                delete allKeys[keyValue];
            }
        }
    });
}

module.exports = { createKey, removeKey, isKeyValid, listKeys, purgeExpiredKeys };
