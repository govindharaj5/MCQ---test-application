// ============================================================================
// Answer model — query functions for the `answers` table
// ============================================================================
// Phase 2 (Feature 6 "store every answer" + Feature 7 "multiple answers"):
// every selection is autosaved immediately, and a question may now hold a LIST
// of selected options. `selected_options` is the authoritative column
// (comma-joined sorted letters, e.g. 'A,C'); `selected_option` (single letter)
// is mirrored for backwards compatibility with any pre-Phase-2 consumer.
// ============================================================================
const { db } = require('../db');
const { normalizeOptionSelection } = require('../utils/validators');
const { toOptionList } = require('../utils/shuffle');

const Answer = {
  /**
   * Insert or update the student's selection for a question (autosave).
   * `options` may be a single letter, an array of letters, or null to clear.
   */
  upsert(attemptId, questionId, options) {
    const list = normalizeOptionSelection(options);
    if (list === null) throw new Error('Invalid selected options.');
    const selectedOptions = toOptionList(list);          // e.g. 'A,C' ('' when cleared)
    const selectedOption = list.length === 1 ? list[0] : null; // legacy single-letter mirror

    const stmt = db.prepare(`
      INSERT INTO answers (attempt_id, question_id, selected_option, selected_options, updated_at)
      VALUES (@attemptId, @questionId, @selectedOption, @selectedOptions, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT (attempt_id, question_id)
      DO UPDATE SET selected_option = @selectedOption,
                    selected_options = @selectedOptions,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run({ attemptId, questionId, selectedOption, selectedOptions });
  },

  findByAttemptId(attemptId) {
    return db.prepare(
      'SELECT question_id, selected_option, selected_options FROM answers WHERE attempt_id = ?',
    ).all(attemptId);
  },

  /** Map of questionId -> sorted array of stored selected letters ([] when unanswered). */
  answerMap(attemptId) {
    const rows = Answer.findByAttemptId(attemptId);
    const map = new Map();
    rows.forEach((r) => {
      map.set(r.question_id, normalizeOptionSelection(r.selected_options ?? r.selected_option));
    });
    return map;
  },
};

module.exports = Answer;
