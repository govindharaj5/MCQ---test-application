// ============================================================================
// Question model — query functions for the `questions` table
// ============================================================================
const { db } = require('../db');

const Question = {
  create(question) {
    const stmt = db.prepare(`
      INSERT INTO questions (test_id, question_text, option_a, option_b, option_c,
                              option_d, correct_option, order_index)
      VALUES (@test_id, @question_text, @option_a, @option_b, @option_c,
              @option_d, @correct_option, @order_index)
    `);
    const info = stmt.run(question);
    return Question.findById(info.lastInsertRowid);
  },

  findById(id) {
    return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  },

  /** All questions for a test, WITH correct answers — admin use only. */
  findByTestId(testId) {
    return db.prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC').all(testId);
  },

  /** Questions for a test WITHOUT correct answers — safe to send to students. */
  findByTestIdPublic(testId) {
    return db.prepare(`
      SELECT id, test_id, question_text, option_a, option_b, option_c, option_d, order_index
      FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC
    `).all(testId);
  },

  update(id, fields) {
    const allowed = ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'order_index'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (keys.length === 0) return Question.findById(id);

    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE questions SET ${setClause} WHERE id = @id`).run({ ...fields, id });
    return Question.findById(id);
  },

  delete(id) {
    return db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  },

  /** Map of questionId -> correct_option, for fast scoring lookups. */
  correctAnswerMap(testId) {
    const rows = db.prepare('SELECT id, correct_option FROM questions WHERE test_id = ?').all(testId);
    const map = new Map();
    rows.forEach((r) => map.set(r.id, r.correct_option));
    return map;
  },
};

module.exports = Question;
