// ============================================================================
// Test controller — admin CRUD for tests
// ============================================================================
const Test = require('../models/Test');
const Attempt = require('../models/Attempt');
const { generateId } = require('../utils/idGenerator');
const { testAvailability } = require('../utils/scoring');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const {
  isNonEmptyString, isValidISODate, isPositiveNumber, isPositiveInteger,
} = require('../utils/validators');

/** Coerces any truthy/falsy input (checkbox booleans, "true"/"false", 1/0) into SQLite's 0/1. */
function toBit(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0;
}

// NEW: proctoring — pulls the opt-in proctoring fields out of a request body,
// coercing booleans to 0/1 and leaving thresholds undefined (so Test.create's
// defaults apply) when not provided. Shared by create and update.
function extractProctoringFields(body) {
  const fields = {};
  if (body.proctoring_enabled !== undefined) fields.proctoring_enabled = toBit(body.proctoring_enabled);
  if (body.webcam_required !== undefined) fields.webcam_required = toBit(body.webcam_required);
  if (body.fullscreen_required !== undefined) fields.fullscreen_required = toBit(body.fullscreen_required);
  if (body.tab_switch_enforced !== undefined) fields.tab_switch_enforced = toBit(body.tab_switch_enforced);
  if (body.max_webcam_violations !== undefined) fields.max_webcam_violations = parseInt(body.max_webcam_violations, 10);
  if (body.max_fullscreen_violations !== undefined) fields.max_fullscreen_violations = parseInt(body.max_fullscreen_violations, 10);
  if (body.max_tab_switch_violations !== undefined) fields.max_tab_switch_violations = parseInt(body.max_tab_switch_violations, 10);
  // NEW (Phase 2, Feature 15): pass threshold, stored as a number.
  if (body.pass_percentage !== undefined && body.pass_percentage !== null && body.pass_percentage !== '') {
    fields.pass_percentage = Number(body.pass_percentage);
  }
  return fields;
}

function validateTestPayload(body, { partial = false } = {}) {
  const errors = [];
  const {
    title, total_questions: totalQuestions, marks_per_question: marksPerQuestion,
    duration_minutes: durationMinutes, start_time: startTime, end_time: endTime,
  } = body;

  if (!partial || title !== undefined) {
    if (!isNonEmptyString(title)) errors.push('Test name is required.');
  }
  if (!partial || totalQuestions !== undefined) {
    if (!isPositiveInteger(totalQuestions)) errors.push('Total questions must be a positive whole number.');
  }
  if (!partial || marksPerQuestion !== undefined) {
    if (!isPositiveNumber(marksPerQuestion)) errors.push('Marks per question must be a positive number.');
  }
  if (!partial || durationMinutes !== undefined) {
    if (!isPositiveInteger(durationMinutes)) errors.push('Duration must be a positive whole number of minutes.');
  }
  if (!partial || startTime !== undefined) {
    if (!isValidISODate(startTime)) errors.push('A valid start date & time is required.');
  }
  if (!partial || endTime !== undefined) {
    if (!isValidISODate(endTime)) errors.push('A valid end date & time is required.');
  }
  if (isValidISODate(startTime) && isValidISODate(endTime) && new Date(endTime) <= new Date(startTime)) {
    errors.push('End date & time must be after the start date & time.');
  }

  // NEW (Phase 2, Feature 15): optional pass threshold — percentage 0–100.
  if (body.pass_percentage !== undefined && body.pass_percentage !== null && body.pass_percentage !== '') {
    const p = Number(body.pass_percentage);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      errors.push('Pass percentage must be between 0 and 100.');
    }
  }

  // NEW: proctoring — threshold fields are optional, but if present must be
  // valid positive integers (guards against NaN ever reaching the database).
  ['max_webcam_violations', 'max_fullscreen_violations', 'max_tab_switch_violations'].forEach((key) => {
    if (body[key] !== undefined && !isPositiveInteger(parseInt(body[key], 10))) {
      errors.push('Violation limits must be positive whole numbers.');
    }
  });

  return errors;
}

function withComputed(test) {
  const questionCount = Test.countQuestions(test.id);
  const stats = Attempt.stats(test.id, test.pass_percentage ?? 40);
  return {
    ...test,
    is_active: !!test.is_active,
    // NEW: proctoring — coerced to real booleans for the admin UI, same treatment as is_active.
    proctoring_enabled: !!test.proctoring_enabled,
    webcam_required: !!test.webcam_required,
    fullscreen_required: !!test.fullscreen_required,
    tab_switch_enforced: !!test.tab_switch_enforced,
    question_count: questionCount,
    availability: testAvailability(test),
    stats,
  };
}

/** POST /api/tests */
const createTest = asyncHandler(async (req, res) => {
  const errors = validateTestPayload(req.body);
  if (errors.length) throw new ApiError(400, errors.join(' '));

  const test = Test.create({
    id: generateId(10),
    title: req.body.title.trim(),
    description: (req.body.description || '').trim(),
    total_questions: req.body.total_questions,
    marks_per_question: req.body.marks_per_question,
    duration_minutes: req.body.duration_minutes,
    start_time: new Date(req.body.start_time).toISOString(),
    end_time: new Date(req.body.end_time).toISOString(),
    ...extractProctoringFields(req.body), // NEW: proctoring (all optional, default OFF)
  });

  res.status(201).json({ success: true, data: withComputed(test) });
});

/** GET /api/tests */
const listTests = asyncHandler(async (req, res) => {
  const tests = Test.findAll().map(withComputed);
  res.json({ success: true, data: tests });
});

/** GET /api/tests/:id */
const getTest = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.id);
  if (!test) throw new ApiError(404, 'Test not found.');
  res.json({ success: true, data: withComputed(test) });
});

/** PUT /api/tests/:id */
const updateTest = asyncHandler(async (req, res) => {
  const existing = Test.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Test not found.');

  const errors = validateTestPayload(req.body, { partial: true });
  if (errors.length) throw new ApiError(400, errors.join(' '));

  const fields = { ...req.body, ...extractProctoringFields(req.body) }; // NEW: proctoring
  if (fields.title) fields.title = fields.title.trim();
  if (fields.start_time) fields.start_time = new Date(fields.start_time).toISOString();
  if (fields.end_time) fields.end_time = new Date(fields.end_time).toISOString();
  if (typeof fields.is_active === 'boolean') fields.is_active = fields.is_active ? 1 : 0;

  const updated = Test.update(req.params.id, fields);
  res.json({ success: true, data: withComputed(updated) });
});

/** DELETE /api/tests/:id */
const deleteTest = asyncHandler(async (req, res) => {
  const existing = Test.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Test not found.');

  Test.delete(req.params.id);
  res.json({ success: true, message: 'Test deleted successfully.' });
});

module.exports = {
  createTest, listTests, getTest, updateTest, deleteTest,
};
