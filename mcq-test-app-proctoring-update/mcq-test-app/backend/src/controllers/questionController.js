// ============================================================================
// Question controller — admin CRUD for questions within a test
// ============================================================================
// Phase 2 (Features 7/8/16/17): questions now accept Google-Forms-style
// settings — description, image, video, points, required, response validation,
// shuffle-options toggle, and MULTIPLE correct answers. All fields are optional
// and every new column has a safe default, so pre-Phase-2 requests (which only
// send question_text/options/correct_option) keep working unchanged.
// ============================================================================
const Test = require('../models/Test');
const Question = require('../models/Question');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { isNonEmptyString, normalizeOptionSelection, normalizeValidationRule } = require('../utils/validators');
const { toOptionList } = require('../utils/shuffle');
const { db } = require('../db');

function validateQuestionPayload(body) {
  const errors = [];
  const {
    question_text: text, option_a: a, option_b: b, option_c: c, option_d: d,
    correct_option: correct, correct_options: correctOptions,
  } = body;

  if (!isNonEmptyString(text)) errors.push('Question text is required.');
  if (!isNonEmptyString(a)) errors.push('Option A is required.');
  if (!isNonEmptyString(b)) errors.push('Option B is required.');
  if (!isNonEmptyString(c)) errors.push('Option C is required.');
  if (!isNonEmptyString(d)) errors.push('Option D is required.');

  // Multiple correct answers (Feature 7): the new array field is authoritative;
  // the legacy single letter still validates questions from older clients.
  const list = correctOptions !== undefined
    ? normalizeOptionSelection(correctOptions)
    : normalizeOptionSelection(correct);
  if (list === null || list.length === 0) {
    errors.push('At least one correct answer must be selected.');
  }

  // Google-Forms-style response validation (Feature 8) — must be well-formed
  // when provided (normalizeValidationRule returns null for disabled rules).
  if (body.validation !== undefined && body.validation !== null) {
    if (normalizeValidationRule(body.validation) === null) {
      errors.push('Response validation must be one of exactly/at least/at most with a value of 1–4.');
    }
  }

  if (body.points !== undefined && body.points !== null && body.points !== '') {
    const p = Number(body.points);
    if (!Number.isFinite(p) || p <= 0) errors.push('Points must be a positive number.');
  }

  return errors;
}

/**
 * Extracts a normalized question row for create/update. Every field is
 * optional here; Question.normalizeRow fills safe defaults for the rest.
 * Note: the DB uses three separate columns for validation (type/value/message);
 * the API accepts a single `validation` object — split it here.
 */
function extractQuestionFields(body) {
  const validation = normalizeValidationRule(body.validation);
  return {
    question_text: body.question_text,
    option_a: body.option_a,
    option_b: body.option_b,
    option_c: body.option_c,
    option_d: body.option_d,
    correct_options: body.correct_options !== undefined
      ? toOptionList(normalizeOptionSelection(body.correct_options))
      : undefined,
    correct_option: body.correct_option,
    answer_count: body.answer_count,
    points: body.points,
    description: body.description,
    image_url: body.image_url,
    video_url: body.video_url,
    is_required: body.is_required,
    validation_type: validation ? validation.type : undefined,
    validation_value: validation ? validation.value : undefined,
    validation_message: validation ? validation.message : undefined,
    shuffle_options: body.shuffle_options,
    order_index: body.order_index,
  };
}

/** GET /api/tests/:testId/questions */
const listQuestions = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const questions = Question.findByTestId(req.params.testId);
  // Serialize the DB columns into the same JSON shape the admin form uses
  // (validation as a single object, correct answers as a list, etc.).
  res.json({
    success: true,
    data: questions.map((q) => ({
      ...q,
      // Array form (not the comma string) — the admin editor iterates it.
      correct_options: normalizeOptionSelection(q.correct_options || q.correct_option),
      validation: q.validation_type && q.validation_value
        ? { type: q.validation_type, value: q.validation_value, message: q.validation_message }
        : null,
    })),
  });
});

/** POST /api/tests/:testId/questions */
const createQuestion = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const errors = validateQuestionPayload(req.body);
  if (errors.length) throw new ApiError(400, errors.join(' '));

  const currentCount = Test.countQuestions(req.params.testId);
  const question = Question.create({
    test_id: req.params.testId,
    ...extractQuestionFields(req.body),
    order_index: Number.isInteger(req.body.order_index) ? req.body.order_index : currentCount,
  });

  res.status(201).json({ success: true, data: question });
});

/** PUT /api/questions/:id */
const updateQuestion = asyncHandler(async (req, res) => {
  const existing = Question.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Question not found.');

  // Validation on the MERGED payload so partial updates still pass the
  // full-question checks (same pattern as the original controller).
  const merged = { ...existing, ...req.body };
  const errors = validateQuestionPayload(merged);
  if (errors.length) throw new ApiError(400, errors.join(' '));

  const fields = {};
  const source = extractQuestionFields(req.body);
  Object.entries(source).forEach(([key, value]) => {
    if (value !== undefined) fields[key] = value;
  });

  const updated = Question.update(req.params.id, fields);
  res.json({ success: true, data: updated });
});

/** DELETE /api/questions/:id */
const deleteQuestion = asyncHandler(async (req, res) => {
  const existing = Question.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Question not found.');

  Question.delete(req.params.id);
  res.json({ success: true, message: 'Question deleted successfully.' });
});

/**
 * POST /api/tests/:testId/questions/reorder  (Feature 16 — drag & drop)
 * Body: { orderedIds: [id, id, ...] } — the full question list in its new
 * order. order_index is rewritten 0..n in one transaction.
 */
const reorderQuestions = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) throw new ApiError(400, 'orderedIds must be an array.');

  const existing = new Set(Question.findByTestId(req.params.testId).map((q) => String(q.id)));
  if (orderedIds.length !== existing.size
    || orderedIds.some((id) => !existing.has(String(id)))) {
    throw new ApiError(400, 'orderedIds must contain every question exactly once.');
  }

  const stmt = db.prepare('UPDATE questions SET order_index = ? WHERE id = ?');
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, id));
  });
  tx();

  res.json({ success: true, data: Question.findByTestId(req.params.testId) });
});

module.exports = {
  listQuestions, createQuestion, updateQuestion, deleteQuestion, reorderQuestions,
};
