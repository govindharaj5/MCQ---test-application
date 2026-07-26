// ============================================================================
// Answer model — query functions for the `answers` table
// ============================================================================
const { db } = require('../db');

const Answer = {
  /** Insert or update the student's selected option for a question (autosave). */
  upsert(attemptId, questionId, selectedOption) {
    const stmt = db.prepare(`
      INSERT INTO answers (attempt_id, question_id, selected_option, updated_at)
      VALUES (@attemptId, @questionId, @selectedOption, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT (attempt_id, question_id)
      DO UPDATE SET selected_option = @selectedOption, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run({ attemptId, questionId, selectedOption });
  },

  findByAttemptId(attemptId) {
    return db.prepare('SELECT question_id, selected_option FROM answers WHERE attempt_id = ?').all(attemptId);
  },

  /** Map of questionId -> selectedOption for fast scoring lookups. */
  answerMap(attemptId) {
    const rows = Answer.findByAttemptId(attemptId);
    const map = new Map();
    rows.forEach((r) => map.set(r.question_id, r.selected_option));
    return map;
  },
};

module.exports = Answer;
