// ============================================================================
// Public controller — everything the student side of the app needs.
// No authentication; protected instead by test-window checks, one-attempt-
// per-register-number enforcement, and per-attempt ownership via unguessable
// attempt IDs.
// ============================================================================
const Test = require('../models/Test');
const Question = require('../models/Question');
const Answer = require('../models/Answer');
const Attempt = require('../models/Attempt');
const { generateId } = require('../utils/idGenerator');
const {
  computeEndAt, remainingSeconds, testAvailability,
} = require('../utils/scoring');
const { finalizeAttempt, autoFinalizeIfExpired } = require('../services/attemptService');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { isNonEmptyString, isValidMobile } = require('../utils/validators');

const AVAILABILITY_MESSAGES = {
  not_started: 'Test has not started yet.',
  expired: 'This test has expired.',
  inactive: 'This test is not currently available.',
};

/** Shape a full "session" payload the test-taking UI can hydrate itself from. */
function buildSessionPayload(attempt, test) {
  const questions = Question.findByTestIdPublic(test.id);
  const answers = Answer.answerMap(attempt.id);
  const answersObject = {};
  answers.forEach((value, key) => { answersObject[key] = value; });

  return {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      studentName: attempt.student_name,
      registerNumber: attempt.register_number,
      startTime: attempt.start_time,
      endAt: attempt.end_at,
      score: attempt.score,
      totalMarks: attempt.total_marks,
      percentage: attempt.percentage,
      timeTakenSeconds: attempt.time_taken_seconds,
      submittedAt: attempt.submitted_at,
    },
    test: {
      id: test.id,
      title: test.title,
      durationMinutes: test.duration_minutes,
      marksPerQuestion: test.marks_per_question,
    },
    questions,
    answers: answersObject,
    remainingTimeSeconds: remainingSeconds(attempt.end_at),
    serverTime: new Date().toISOString(),
  };
}

/** GET /api/public/tests/:id/meta */
const getTestMeta = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.id);
  if (!test) throw new ApiError(404, 'Test not found. Please check the link and try again.');

  const availability = testAvailability(test);
  const questionCount = Test.countQuestions(test.id);

  res.json({
    success: true,
    data: {
      id: test.id,
      title: test.title,
      description: test.description,
      durationMinutes: test.duration_minutes,
      totalQuestions: test.total_questions,
      questionCount,
      marksPerQuestion: test.marks_per_question,
      startTime: test.start_time,
      endTime: test.end_time,
      availability,
      message: AVAILABILITY_MESSAGES[availability] || null,
    },
  });
});

/** POST /api/public/tests/:id/start */
const startAttempt = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.id);
  if (!test) throw new ApiError(404, 'Test not found. Please check the link and try again.');

  const availability = testAvailability(test);
  if (availability !== 'live') {
    throw new ApiError(403, AVAILABILITY_MESSAGES[availability] || 'This test is not currently available.');
  }

  const questionCount = Test.countQuestions(test.id);
  if (questionCount === 0) {
    throw new ApiError(409, 'This test is not ready yet. Please contact the administrator.');
  }

  const { student_name: studentName, register_number: registerNumber, mobile_number: mobileNumber } = req.body;
  if (!isNonEmptyString(studentName) || studentName.trim().length > 100) {
    throw new ApiError(400, 'Please enter a valid name.');
  }
  if (!isNonEmptyString(registerNumber) || registerNumber.trim().length > 100) {
  throw new ApiError(400, 'Please enter a valid college / company name.');
}

if (!isNonEmptyString(mobileNumber) || mobileNumber.trim().length > 50) {
  throw new ApiError(400, 'Please select a designation.');
}

  // One attempt per register number per test.
  const existing = Attempt.findByTestAndRegister(test.id, registerNumber.trim());
  if (existing) {
    const resolved = autoFinalizeIfExpired(existing);
    if (resolved.status === 'completed') {
      throw new ApiError(409, 'You have already attempted this test. Multiple attempts are not allowed.');
    }
    // Still in progress — resume rather than block, so a refresh/reopen doesn't lock the student out.
    return res.json({ success: true, data: buildSessionPayload(resolved, test) });
  }

  const now = new Date();
  const endAt = computeEndAt(now, test.duration_minutes, test.end_time);

  let attempt;
  try {
    attempt = Attempt.create({
      id: generateId(12),
      test_id: test.id,
      student_name: studentName.trim(),
      register_number: registerNumber.trim(),
      mobile_number: mobileNumber.trim(),
      start_time: now.toISOString(),
      end_at: endAt.toISOString(),
      remaining_time_seconds: remainingSeconds(endAt, now),
    });
  } catch (err) {
    // Race condition: two requests for the same register number arrived at once.
    if (String(err.message).includes('UNIQUE')) {
      const raceExisting = Attempt.findByTestAndRegister(test.id, registerNumber.trim());
      if (raceExisting) {
        return res.json({ success: true, data: buildSessionPayload(raceExisting, test) });
      }
    }
    throw err;
  }

  res.status(201).json({ success: true, data: buildSessionPayload(attempt, test) });
});

/** GET /api/public/attempts/:attemptId/session — full rehydration payload, used on every load/refresh. */
const getSession = asyncHandler(async (req, res) => {
  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found.');

  const resolved = autoFinalizeIfExpired(attempt);
  const test = Test.findById(resolved.test_id);

  res.json({ success: true, data: buildSessionPayload(resolved, test) });
});

/** PUT /api/public/attempts/:attemptId/answer — autosave */
const saveAnswer = asyncHandler(async (req, res) => {
  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found.');

  const resolved = autoFinalizeIfExpired(attempt);
  if (resolved.status !== 'in_progress') {
    throw new ApiError(409, 'Time is up. Your test has already been submitted.');
  }

  const { question_id: questionId, selected_option: selectedOption } = req.body;
  const question = Question.findById(questionId);
  if (!question || question.test_id !== attempt.test_id) {
    throw new ApiError(400, 'Invalid question for this attempt.');
  }
  if (selectedOption !== null && !['A', 'B', 'C', 'D'].includes(selectedOption)) {
    throw new ApiError(400, 'Invalid selected option.');
  }

  Answer.upsert(attempt.id, questionId, selectedOption);
  const remaining = remainingSeconds(attempt.end_at);
  Attempt.updateRemainingTime(attempt.id, remaining);

  res.json({ success: true, data: { remainingTimeSeconds: remaining } });
});

/** POST /api/public/attempts/:attemptId/submit */
const submitAttempt = asyncHandler(async (req, res) => {
  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found.');

  const finalized = finalizeAttempt(attempt.id);
  res.json({
    success: true,
    data: {
      score: finalized.score,
      totalMarks: finalized.total_marks,
      percentage: finalized.percentage,
      timeTakenSeconds: finalized.time_taken_seconds,
      submittedAt: finalized.submitted_at,
      studentName: finalized.student_name,
      registerNumber: finalized.register_number,
    },
  });
});

module.exports = {
  getTestMeta, startAttempt, getSession, saveAnswer, submitAttempt,
};
