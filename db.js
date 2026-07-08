// ─────────────────────────────────────────────────────────────────────────────
//  db.js  –  MySQL connection pool, wrapped to match keys.js's expectations
// ─────────────────────────────────────────────────────────────────────────────
//
//  Uses mysql2/promise (already installed by setup.sh). Note the unwrap in
//  query(): mysql2's pool.query() resolves to a [rows, fields] tuple, but
//  keys.js calls `const rows = await db.query(...)` expecting rows directly
//  — this wrapper does that unwrapping once, here, so every caller stays
//  simple.
//
//  Reads connection details from .env (DB_HOST, DB_NAME, DB_USER, DB_PASS),
//  the same file setup.sh already wrote — nothing new to configure.
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
 * [rows, fields] tuple — this is what keys.js and any future code should
 * call directly.
 *
 *   const rows = await query('SELECT * FROM dns_keys WHERE key_value = ?', [key]);
 *   await query('INSERT INTO dns_keys (key_value, telegram_id, expires_at) VALUES (?, ?, ?)', [k, id, exp]);
 */
async function query(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

module.exports = { query, pool };
