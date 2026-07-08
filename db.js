// ─────────────────────────────────────────────────────────────────────────────
//  db.js  –  Local bookkeeping database wrapper (MAIN VPS ONLY)
// ─────────────────────────────────────────────────────────────────────────────
//
//  This file only belongs on the main VPS. It connects to the local MySQL
//  instance that setup-main.sh installs (DB_HOST=127.0.0.1 always — this is
//  never reached over the network by anything, including regional
//  servers). Regional servers have no database at all; see their keys.js
//  for the file-based key storage they use instead.
//
//  What this database is FOR: a record of every key ever issued, across
//  every region, for support/audit/analytics purposes (e.g. a future "My
//  Keys" bot menu). It is NOT what decides whether a key is currently
//  valid — that's each regional server's own local file, checked on every
//  DNS query without a network round-trip.
//
//  Reads connection details from .env (DB_HOST, DB_NAME, DB_USER, DB_PASS),
//  written by setup-main.sh.
// ─────────────────────────────────────────────────────────────────────────────

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * Usage: run any SQL statement with placeholders. Returns just the rows
 * (or the result metadata for INSERT/UPDATE/DELETE), not the raw mysql2
 * [rows, fields] tuple.
 *
 *   const rows = await query('SELECT * FROM issued_keys WHERE telegram_id = ?', [id]);
 *   await query('INSERT INTO issued_keys (key_value, telegram_id, region, expires_at) VALUES (?, ?, ?, ?)', [k, id, region, exp]);
 */
async function query(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

module.exports = { query, pool };
