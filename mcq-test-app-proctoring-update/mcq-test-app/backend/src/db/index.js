// ============================================================================
// Database connection (SQLite via better-sqlite3)
// ============================================================================
// better-sqlite3 is synchronous, which removes a huge amount of async/await
// ceremony from every query in this project and is perfectly safe here
// because SQLite writes are already serialized internally.
//
// Why SQLite instead of Firebase Firestore / MySQL:
//   The project brief allowed "Firebase Firestore (or MySQL if easier)".
//   SQLite is a real relational SQL database (so the schema, joins, and
//   transactional guarantees you'd want for exam scoring all apply) but
//   needs zero external setup: no cloud project, no credentials, no
//   separate server process to install and run. `npm install && npm start`
//   is enough. The data access layer (src/models/*) is plain parameterized
//   SQL, so swapping the driver for `mysql2` later is a small, contained
//   change — see README.md "Swapping the database" section.
// ============================================================================

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('./migrate');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'mcqtest.db');

// Ensure the data directory exists (fresh clone won't have it, since it's gitignored)
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // better concurrent read/write performance
db.pragma('foreign_keys = ON');

/**
 * Runs the schema.sql file (idempotent — uses CREATE TABLE IF NOT EXISTS).
 */
function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

/**
 * Ensures a single admin account exists, seeded from environment variables.
 * If an admin with ADMIN_USERNAME already exists, this is a no-op — so
 * editing .env's ADMIN_PASSWORD after first run will NOT silently change
 * an existing account (use the /api/auth/change-password endpoint instead,
 * or delete the DB file to force a fresh reseed). This is documented in
 * README.md.
 */
function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) return;

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  // eslint-disable-next-line no-console
  console.log(`Seeded admin account "${username}" (see backend/.env to change credentials).`);
}

function initDatabase() {
  initSchema();
  runMigrations(db); // safe/additive — brings older databases up to date, see migrate.js
  seedAdmin();
}

module.exports = { db, initDatabase, DB_PATH };
