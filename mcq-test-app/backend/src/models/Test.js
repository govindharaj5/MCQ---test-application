// ============================================================================
// Test model — query functions for the `tests` table
// ============================================================================
const { db } = require('../db');

const Test = {
  create(test) {
    const stmt = db.prepare(`
      INSERT INTO tests (id, title, description, total_questions, marks_per_question,
                          duration_minutes, start_time, end_time)
      VALUES (@id, @title, @description, @total_questions, @marks_per_question,
              @duration_minutes, @start_time, @end_time)
    `);
    stmt.run(test);
    return Test.findById(test.id);
  },

  findById(id) {
    return db.prepare('SELECT * FROM tests WHERE id = ?').get(id);
  },

  findAll() {
    return db.prepare('SELECT * FROM tests ORDER BY created_at DESC').all();
  },

  update(id, fields) {
    const allowed = [
      'title', 'description', 'total_questions', 'marks_per_question',
      'duration_minutes', 'start_time', 'end_time', 'is_active',
    ];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (keys.length === 0) return Test.findById(id);

    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    const stmt = db.prepare(`
      UPDATE tests SET ${setClause}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = @id
    `);
    stmt.run({ ...fields, id });
    return Test.findById(id);
  },

  delete(id) {
    return db.prepare('DELETE FROM tests WHERE id = ?').run(id);
  },

  /** Count of actual questions added (may differ from the `total_questions` target). */
  countQuestions(testId) {
    const row = db.prepare('SELECT COUNT(*) AS count FROM questions WHERE test_id = ?').get(testId);
    return row.count;
  },
};

module.exports = Test;
