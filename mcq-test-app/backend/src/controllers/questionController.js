// ============================================================================
// Question controller — admin CRUD for questions within a test
// ============================================================================
const Test = require('../models/Test');
const Question = require('../models/Question');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { isNonEmptyString, isValidOption } = require('../utils/validators');

function validateQuestionPayload(body) {
  const errors = [];
  const {
    question_text: text, option_a: a, option_b: b, option_c: c, option_d: d, correct_option: correct,
  } = body;

  if (!isNonEmptyString(text)) errors.push('Question text is required.');
  if (!isNonEmptyString(a)) errors.push('Option A is required.');
  if (!isNonEmptyString(b)) errors.push('Option B is required.');
  if (!isNonEmptyString(c)) errors.push('Option C is required.');
  if (!isNonEmptyString(d)) errors.push('Option D is required.');
  if (!isValidOption(correct)) errors.push('Correct option must be one of A, B, C, or D.');

  return errors;
}

/** GET /api/tests/:testId/questions */
const listQuestions = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const questions = Question.findByTestId(req.params.testId);
  res.json({ success: true, data: questions });
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
    question_text: req.body.question_text.trim(),
    option_a: req.body.option_a.trim(),
    option_b: req.body.option_b.trim(),
    option_c: req.body.option_c.trim(),
    option_d: req.body.option_d.trim(),
    correct_option: req.body.correct_option,
    order_index: Number.isInteger(req.body.order_index) ? req.body.order_index : currentCount,
  });

  res.status(201).json({ success: true, data: question });
});

/** PUT /api/questions/:id */
const updateQuestion = asyncHandler(async (req, res) => {
  const existing = Question.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Question not found.');

  const merged = { ...existing, ...req.body };
  const errors = validateQuestionPayload(merged);
  if (errors.length) throw new ApiError(400, errors.join(' '));

  const fields = {};
  ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'order_index']
    .forEach((key) => {
      if (req.body[key] !== undefined) {
        fields[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
      }
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

module.exports = {
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
};
