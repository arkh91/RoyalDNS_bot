// ─────────────────────────────────────────────────────────────────────────────
//  manage-keys.js  –  CLI for creating/removing keys locally on this VPS
// ─────────────────────────────────────────────────────────────────────────────
//
//  This lets you test key issuance/revocation on a regional server WITHOUT
//  running the Telegram bot here — the bot only runs on your main VPS. Once
//  the main VPS is ready to control regional servers remotely, this is the
//  logic that an admin API endpoint would call instead of a human typing
//  commands — same createKey/removeKey functions either way.
//
//  Usage:
//    node manage-keys.js create <telegram-id> <days>
//    node manage-keys.js remove <key> [--hard]
//    node manage-keys.js list
//
//  Examples:
//    node manage-keys.js create 123456789 30
//    node manage-keys.js remove a1A10A4qQmNCh3GgcL0e2w
//    node manage-keys.js remove a1A10A4qQmNCh3GgcL0e2w --hard
//    node manage-keys.js list
//
// ─────────────────────────────────────────────────────────────────────────────

const keys = require('./keys');
const db = require('./db');

const [, , command, ...args] = process.argv;

/**
 * Usage: internal — creates a key for the given Telegram ID and duration,
 * then prints the URL to hand to the customer. Called when command is
 * "create". Not meant to be called from other modules — use keys.createKey
 * directly for that.
 *
 *   await runCreate(['123456789', '30']);
 */
async function runCreate([telegramId, days]) {
    if (!telegramId || !days) {
        console.error('Usage: node manage-keys.js create <telegram-id> <days>');
        process.exit(1);
    }
    const issued = await keys.createKey(Number(telegramId), Number(days));
    console.log('✅ Key created:');
    console.log(`   URL:     ${issued.dohUrl}`);
    console.log(`   Expires: ${issued.expiresAt.toISOString()}`);
}

/**
 * Usage: internal — revokes (or, with --hard, deletes) a key by its value.
 * Called when command is "remove".
 *
 *   await runRemove(['a1A10A4qQmNCh3GgcL0e2w', '--hard']);
 */
async function runRemove([keyValue, flag]) {
    if (!keyValue) {
        console.error('Usage: node manage-keys.js remove <key> [--hard]');
        process.exit(1);
    }
    // Forgiving of copy-paste: if someone pastes the full URL or a leading
    // "/" from the path, pull out just the key itself.
    const cleanKey = keyValue.replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');

    const hardDelete = flag === '--hard';
    const removed = await keys.removeKey(cleanKey, hardDelete);
    if (!removed) {
        console.error(`❌ No matching key found for: ${cleanKey}`);
        console.error('   (check for typos, or run "node manage-keys.js list" to see valid keys)');
        process.exit(1);
    }
    console.log(hardDelete ? `✅ Key permanently deleted: ${cleanKey}` : `✅ Key revoked: ${cleanKey}`);
}

/**
 * Usage: internal — lists every key in the table with its status, so you
 * can eyeball what's active/expired/revoked without a MySQL client. Called
 * when command is "list".
 *
 *   await runList();
 */
async function runList() {
    const rows = await keys.listKeys();
    if (rows.length === 0) {
        console.log('(no keys yet)');
        return;
    }
    for (const row of rows) {
        console.log(`${row.key_value}  telegram=${row.telegram_id}  expires=${row.expires_at.toISOString()}  [${row.status.toUpperCase()}]`);
    }
}

/**
 * Usage: entry point — dispatches to the right handler based on the first
 * CLI argument, then exits cleanly (closing the MySQL pool so the process
 * doesn't hang open).
 */
async function main() {
    if (command === 'create') await runCreate(args);
    else if (command === 'remove') await runRemove(args);
    else if (command === 'list') await runList();
    else {
        console.error('Usage:');
        console.error('  node manage-keys.js create <telegram-id> <days>');
        console.error('  node manage-keys.js remove <key> [--hard]');
        console.error('  node manage-keys.js list');
        process.exit(1);
    }
    await db.pool.end();
}

main().catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
