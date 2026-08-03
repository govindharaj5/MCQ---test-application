// ============================================================================
// Violation model — query functions for the `violations` table (NEW)
// ============================================================================
// Full audit trail of every proctoring event: tab switches, webcam drops,
// fullscreen exits, and blocked devtools/copy attempts. Separate from the
// running counters on `attempts` (tab_switch_count etc.) — the counters are
// for fast threshold checks, this table is the detailed "what happened when"
// log an admin can review (Feature: "Log every webcam violation").
// ============================================================================
const { db } = require('../db');

const Violation = {
  log(attemptId, violationType, details = null) {
    const stmt = db.prepare(`
      INSERT INTO violations (attempt_id, violation_type, details)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(attemptId, violationType, details);
    return db.prepare('SELECT * FROM violations WHERE id = ?').get(info.lastInsertRowid);
  },

  findByAttemptId(attemptId) {
    return db.prepare(
      'SELECT * FROM violations WHERE attempt_id = ? ORDER BY created_at ASC',
    ).all(attemptId);
  },
};

module.exports = Violation;
