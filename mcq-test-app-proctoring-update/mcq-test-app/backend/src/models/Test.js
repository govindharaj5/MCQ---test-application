// ============================================================================
// Test model — query functions for the `tests` table
// ============================================================================
const { db } = require('../db');

const Test = {
  create(test) {
    const stmt = db.prepare(`
      INSERT INTO tests (id, title, description, total_questions, marks_per_question,
                          duration_minutes, start_time, end_time, proctoring_enabled,
                          webcam_required, fullscreen_required, tab_switch_enforced,
                          max_webcam_violations, max_fullscreen_violations, max_tab_switch_violations,
                          pass_percentage)
      VALUES (@id, @title, @description, @total_questions, @marks_per_question,
              @duration_minutes, @start_time, @end_time, @proctoring_enabled,
              @webcam_required, @fullscreen_required, @tab_switch_enforced,
              @max_webcam_violations, @max_fullscreen_violations, @max_tab_switch_violations,
              @pass_percentage)
    `);
    // New proctoring fields default to OFF/spec-default here so any existing
    // caller that doesn't know about them yet still works unmodified.
    stmt.run({
      proctoring_enabled: 0,
      webcam_required: 0,
      fullscreen_required: 0,
      tab_switch_enforced: 0,
      max_webcam_violations: 2,
      max_fullscreen_violations: 2,
      max_tab_switch_violations: 3,
      pass_percentage: 40, // Phase 2 (Feature 15): analytics pass threshold
      ...test,
    });
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
      // Proctoring & Security (opt-in, added without touching any existing field)
      'proctoring_enabled', 'webcam_required', 'fullscreen_required', 'tab_switch_enforced',
      'max_webcam_violations', 'max_fullscreen_violations', 'max_tab_switch_violations',
      // Phase 2 (Feature 15): analytics pass threshold
      'pass_percentage',
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
