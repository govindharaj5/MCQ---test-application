// ============================================================================
// Question model — query functions for the `questions` table
// ============================================================================
// Phase 2 (Features 7/8/16): questions now support multiple correct answers,
// per-question points, description, image/video, "required", Google-Forms-style
// response validation, and a per-question shuffle-options toggle. All new
// columns are additive with safe defaults, so existing questions (and any
// caller that doesn't know about the new fields) behave exactly as before.
// ============================================================================
const { db } = require('../db');
const {
  normalizeOptionSelection, normalizeValidationRule, isPositiveNumber,
} = require('../utils/validators');
const { toOptionList } = require('../utils/shuffle');

const Question = {
  create(question) {
    const stmt = db.prepare(`
      INSERT INTO questions (test_id, question_text, option_a, option_b, option_c,
                              option_d, correct_option, correct_options, answer_count,
                              points, description, image_url, video_url, is_required,
                              validation_type, validation_value, validation_message,
                              shuffle_options, order_index)
      VALUES (@test_id, @question_text, @option_a, @option_b, @option_c,
              @option_d, @correct_option, @correct_options, @answer_count,
              @points, @description, @image_url, @video_url, @is_required,
              @validation_type, @validation_value, @validation_message,
              @shuffle_options, @order_index)
    `);
    const info = stmt.run(Question.normalizeRow(question));
    return Question.findById(info.lastInsertRowid);
  },

  findById(id) {
    return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  },

  /** All questions for a test, WITH correct answers — admin use only. */
  findByTestId(testId) {
    return db.prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC').all(testId);
  },

  /**
   * Questions for a test WITHOUT correct answers — safe to send to students.
   * Includes the new public-facing settings (validation, required, shuffle,
   * points, media) but never correct_options/correct_option — scoring stays
   * server-side only, exactly as before (README "Security notes").
   */
  findByTestIdPublic(testId) {
    return db.prepare(`
      SELECT id, test_id, question_text, option_a, option_b, option_c, option_d,
             order_index, answer_count, points, description, image_url, video_url,
             is_required, validation_type, validation_value, validation_message,
             shuffle_options
      FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC
    `).all(testId);
  },

  update(id, fields) {
    const allowed = [
      'question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option',
      'correct_options', 'answer_count', 'points', 'description', 'image_url', 'video_url',
      'is_required', 'validation_type', 'validation_value', 'validation_message',
      'shuffle_options', 'order_index',
    ];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (keys.length === 0) return Question.findById(id);

    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE questions SET ${setClause} WHERE id = @id`).run({ ...fields, id });
    return Question.findById(id);
  },

  delete(id) {
    return db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  },

  /**
   * Map of questionId -> { correct: string[], points: number } for fast
   * scoring. `correct` is the sorted array of stored correct letters
   * (single-element for pre-Phase-2 questions).
   */
  correctAnswerMap(testId, fallbackPoints = 1) {
    const rows = db.prepare('SELECT id, correct_options, correct_option, points FROM questions WHERE test_id = ?').all(testId);
    const map = new Map();
    rows.forEach((r) => {
      const correct = normalizeOptionSelection(r.correct_options || r.correct_option);
      map.set(r.id, {
        correct,
        points: r.points !== null && r.points !== undefined && Number.isFinite(Number(r.points))
          ? Number(r.points)
          : fallbackPoints,
      });
    });
    return map;
  },

  /**
   * Normalizes an incoming (admin-supplied) question row so every new column
   * has a safe value even if the caller predates Phase 2. This is the single
   * place that translates the API's JSON shape into the DB column values.
   * The validation rule may arrive either as a single `validation` object
   * (admin form) or as the split type/value/message columns.
   */
  normalizeRow(q) {
    const correctList = normalizeOptionSelection(q.correct_options ?? q.correct_option);
    if (correctList === null) correctList = ['A'];
    const correctOptions = toOptionList(correctList);
    const single = correctOptions.split(',')[0] || q.correct_option || 'A';
    const rule = normalizeValidationRule(
      q.validation ?? {
        type: q.validation_type,
        value: q.validation_value,
        message: q.validation_message,
      },
    );

    const points = q.points !== undefined && q.points !== null && q.points !== ''
      ? (isPositiveNumber(Number(q.points)) ? Number(q.points) : null)
      : null;

    const intOr = (v, fallback) => {
      const n = Number.parseInt(v, 10);
      return Number.isInteger(n) && n >= 0 ? n : fallback;
    };

    return {
      test_id: q.test_id,
      question_text: String(q.question_text ?? '').trim(),
      option_a: String(q.option_a ?? '').trim(),
      option_b: String(q.option_b ?? '').trim(),
      option_c: String(q.option_c ?? '').trim(),
      option_d: String(q.option_d ?? '').trim(),
      correct_option: single,
      correct_options: correctOptions,
      answer_count: intOr(q.answer_count, Math.max(1, correctList.length)),
      points,
      description: String(q.description ?? '').trim(),
      image_url: String(q.image_url ?? '').trim(),
      video_url: String(q.video_url ?? '').trim(),
      is_required: q.is_required ? 1 : 0,
      validation_type: rule ? rule.type : null,
      validation_value: rule ? rule.value : null,
      validation_message: rule ? rule.message : null,
      shuffle_options: q.shuffle_options === undefined || q.shuffle_options === null
        ? 1
        : (q.shuffle_options ? 1 : 0),
      order_index: intOr(q.order_index, 0),
    };
  },
};

module.exports = Question;
