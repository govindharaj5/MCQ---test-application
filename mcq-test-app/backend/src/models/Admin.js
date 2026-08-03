// ============================================================================
// Admin model — query functions for the `admins` table
// ============================================================================
const { db } = require('../db');

const Admin = {
  findByUsername(username) {
    return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  },

  findById(id) {
    return db.prepare('SELECT id, username, created_at FROM admins WHERE id = ?').get(id);
  },

  updatePassword(id, passwordHash) {
    return db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
};

module.exports = Admin;
