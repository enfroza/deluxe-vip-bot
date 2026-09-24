const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
require("dotenv").config();

const DB_PATH = process.env.DATABASE_PATH || "./data/deluxevip.sqlite";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id   INTEGER PRIMARY KEY,
    username      TEXT,
    first_name    TEXT,
    first_seen_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id         INTEGER NOT NULL,
    amount_stars        INTEGER NOT NULL,
    invoice_payload     TEXT NOT NULL,
    telegram_charge_id  TEXT,
    status              TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
    invite_link         TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    paid_at             TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function seedConfig() {
  const defaults = {
    price_stars: process.env.DEFAULT_PRICE_STARS || "499",
    channel_id: process.env.CHANNEL_ID || "",
    channel_name: process.env.CHANNEL_NAME || "DELUXE VIP",
  };
  const insert = db.prepare(
    "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)"
  );
  for (const [k, v] of Object.entries(defaults)) insert.run(k, String(v));
}
seedConfig();

const getConfig = (key) => {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? row.value : null;
};

const setConfig = (key, value) => {
  db.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
};

const upsertUser = (telegram_id, username, first_name) => {
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name`
  ).run(telegram_id, username || null, first_name || null);
};

const createPendingPurchase = (telegram_id, amount_stars, invoice_payload) => {
  const info = db
    .prepare(
      `INSERT INTO purchases (telegram_id, amount_stars, invoice_payload, status)
       VALUES (?, ?, ?, 'pending')`
    )
    .run(telegram_id, amount_stars, invoice_payload);
  return info.lastInsertRowid;
};

const markPurchasePaid = (invoice_payload, telegram_charge_id, invite_link) => {
  db.prepare(
    `UPDATE purchases
     SET status = 'paid', telegram_charge_id = ?, invite_link = ?, paid_at = datetime('now')
     WHERE invoice_payload = ?`
  ).run(telegram_charge_id, invite_link, invoice_payload);
};

const getLatestPaidPurchase = (telegram_id) =>
  db
    .prepare(
      `SELECT * FROM purchases WHERE telegram_id = ? AND status = 'paid'
       ORDER BY paid_at DESC LIMIT 1`
    )
    .get(telegram_id);

const getStats = () => {
  const revenue = db
    .prepare(`SELECT COALESCE(SUM(amount_stars), 0) AS total FROM purchases WHERE status = 'paid'`)
    .get().total;
  const subscribers = db
    .prepare(`SELECT COUNT(*) AS n FROM purchases WHERE status = 'paid'`)
    .get().n;
  const totalUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const recent = db
    .prepare(
      `SELECT p.telegram_id, u.username, p.amount_stars, p.paid_at
       FROM purchases p LEFT JOIN users u ON u.telegram_id = p.telegram_id
       WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 10`
    )
    .all();
  return { revenue, subscribers, totalUsers, recent };
};

const getAllPaidUserIds = () =>
  db
    .prepare(`SELECT DISTINCT telegram_id FROM purchases WHERE status = 'paid'`)
    .all()
    .map((r) => r.telegram_id);

module.exports = {
  db,
  getConfig,
  setConfig,
  upsertUser,
  createPendingPurchase,
  markPurchasePaid,
  getLatestPaidPurchase,
  getStats,
  getAllPaidUserIds,
};
