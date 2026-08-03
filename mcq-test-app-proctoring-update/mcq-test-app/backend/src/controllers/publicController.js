// ============================================================================
// Public controller — everything the student side of the app needs.
// No authentication; protected instead by test-window checks, one-attempt-
// per-register-number enforcement, and per-attempt ownership via unguessable
// attempt IDs + a single-active-session token (Phase 2, Feature 14).
// ============================================================================
const Test = require('../models/Test');
const Question = require('../models/Question');
const Answer = require('../models/Answer');
const Attempt = require('../models/Attempt');
const Violation = require('../models/Violation'); // NEW: proctoring audit log
const { generateId } = require('../utils/idGenerator');
const {
  computeEndAt, remainingSeconds, testAvailability,
} = require('../utils/scoring');
const {
  buildOptionOrder, shuffleQuestions,
} = require('../utils/shuffle');
const { finalizeAttempt, autoFinalizeIfExpired } = require('../services/attemptService');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { getToken } = require('../middleware/attemptAuth');
const { isNonEmptyString, normalizeOptionSelection } = require('../utils/validators');

const AVAILABILITY_MESSAGES = {
  not_started: 'Test has not started yet.',
  expired: 'This test has expired.',
  inactive: 'This test is not currently available.',
};

/**
 * Builds the response validation descriptor a question sends to the browser.
 * Old questions (no validation, answer_count 1, not required) send `null` —
 * the student UI then behaves exactly as it always did (free single-select).
 */
function publicValidation(q) {
  const hasRule = q.validation_type && q.validation_value;
  if (hasRule) {
    return {
      type: q.validation_type,
      value: q.validation_value,
      message: q.validation_message || null,
    };
  }
  // Feature 7: questions configured with N>1 required answers default to an
  // "exactly N" rule even when the admin didn't use the explicit validation UI.
  if (q.answer_count > 1) {
    return {
      type: 'exact',
      value: q.answer_count,
      message: `Please select exactly ${q.answer_count} answers.`,
    };
  }
  return null;
}

/**
 * Shape a full "session" payload the test-taking UI can hydrate itself from.
 * Phase 2 (Features 9/10): questions AND options arrive in a deterministic
 * per-attempt shuffled order (seeded by attempt id), so:
 *   - every student gets a different order,
 *   - the SAME student gets the SAME order on refresh (resume works),
 *   - correct-answer integrity is untouched (answers are stored in the
 *     canonical option letters; only the display positions change).
 */
function buildSessionPayload(attempt, test) {
  const rawQuestions = Question.findByTestIdPublic(test.id);
  const answers = Answer.answerMap(attempt.id);
  const answersObject = {};
  answers.forEach((list, questionId) => { answersObject[questionId] = list; });

  const questions = shuffleQuestions(rawQuestions, attempt.id).map((q) => ({
    id: q.id,
    question_text: q.question_text,
    description: q.description || '',
    image_url: q.image_url || null,
    video_url: q.video_url || null,
    points: q.points !== null && q.points !== undefined ? Number(q.points) : test.marks_per_question,
    // Tells the UI whether to render radio (1) or checkbox (N) options.
    answerCount: Number(q.answer_count) || 1,
    // The shuffled A–D display list; each entry maps a display label to the
    // canonical stored letter, so the student UI can save answers safely.
    options: buildOptionOrder(q, attempt.id, q.shuffle_options !== 0),
    validation: publicValidation(q),
    required: !!q.is_required,
  }));

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
      // NEW (Phase 2, Feature 14): the single-active-session token the browser
      // must present on every subsequent request (see middleware/attemptAuth.js).
      sessionToken: attempt.session_token || null,
      // Proctoring — current violation counts, so a refreshed tab resumes
      // with the correct warning counts instead of silently resetting to zero.
      tabSwitchCount: attempt.tab_switch_count,
      webcamViolationCount: attempt.webcam_violation_count,
      fullscreenViolationCount: attempt.fullscreen_violation_count,
    },
    test: {
      id: test.id,
      title: test.title,
      durationMinutes: test.duration_minutes,
      marksPerQuestion: test.marks_per_question,
      // NEW (Phase 2, Feature 15): pass threshold, so the result page can show
      // a Pass/Fail verdict consistent with the admin side.
      passPercentage: test.pass_percentage ?? 40,
      // Proctoring config — all opt-in, OFF for every test created before
      // this feature existed. The frontend only activates webcam/fullscreen/tab
      // monitoring when the relevant flag here is true.
      proctoring: {
        enabled: !!test.proctoring_enabled,
        webcamRequired: !!test.webcam_required,
        fullscreenRequired: !!test.fullscreen_required,
        tabSwitchEnforced: !!test.tab_switch_enforced,
        maxWebcamViolations: test.max_webcam_violations,
        maxFullscreenViolations: test.max_fullscreen_violations,
        maxTabSwitchViolations: test.max_tab_switch_violations,
      },
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
      // Proctoring — lets the entry page warn the student what this
      // particular test requires (webcam / fullscreen) before they start.
      proctoring: {
        enabled: !!test.proctoring_enabled,
        webcamRequired: !!test.webcam_required,
        fullscreenRequired: !!test.fullscreen_required,
        tabSwitchEnforced: !!test.tab_switch_enforced,
      },
    },
  });
});

/**
 * Issues a session payload for an in-progress attempt, always minting a FRESH
 * session token (which invalidates any token an older tab might still hold).
 */
function resumeOrCreateSessionPayload(attempt, test) {
  const token = Attempt.issueSessionToken(attempt.id);
  const resolved = { ...attempt, session_token: token };
  return buildSessionPayload(resolved, test);
}

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
    // Still in progress — resume rather than block, so a refresh/reopen doesn't
    // lock the student out. A fresh token is issued here too, so re-entering
    // the link from a SECOND tab displaces the first tab (Feature 14).
    return res.json({ success: true, data: resumeOrCreateSessionPayload(resolved, test) });
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
      session_token: null, // issued below, after the row exists
    });
  } catch (err) {
    // Race condition: two requests for the same register number arrived at once.
    if (String(err.message).includes('UNIQUE')) {
      const raceExisting = Attempt.findByTestAndRegister(test.id, registerNumber.trim());
      if (raceExisting) {
        return res.json({ success: true, data: resumeOrCreateSessionPayload(raceExisting, test) });
      }
    }
    throw err;
  }

  res.status(201).json({ success: true, data: resumeOrCreateSessionPayload(attempt, test) });
});

/**
 * GET /api/public/attempts/:attemptId/session — full rehydration payload, used
 * on every load/refresh. Token rules (Phase 2, Feature 14):
 *   - attempt completed          -> payload without token (result page reads)
 *   - token matches              -> normal payload
 *   - no token (fresh tab/reopen)-> NEW token issued, old sessions displaced
 *   - stale token                -> 409 session_revoked (loser of a multi-tab fight)
 */
const getSession = asyncHandler(async (req, res) => {
  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found.');

  const resolved = autoFinalizeIfExpired(attempt);
  const test = Test.findById(resolved.test_id);

  if (resolved.status !== 'in_progress') {
    return res.json({ success: true, data: buildSessionPayload(resolved, test) });
  }

  const token = getToken(req);
  if (token && token !== resolved.session_token) {
    throw new ApiError(409, 'This test session is no longer active.', 'session_revoked');
  }
  if (token && token === resolved.session_token) {
    return res.json({ success: true, data: buildSessionPayload(resolved, test) });
  }

  // Fresh page load without a token — claim the session (displaces any older tab).
  return res.json({ success: true, data: resumeOrCreateSessionPayload(resolved, test) });
});

/**
 * PUT /api/public/attempts/:attemptId/answer — autosave.
 * Protected by requireAttemptToken. Accepts either a single letter or an array
 * of letters (Phase 2, Feature 7 — multiple answers), e.g.
 *   { question_id: 3, selected_options: ['A','C'] }
 * Every selection change is persisted immediately (Feature 6), so even an
 * auto-submit that happens a moment later scores the answers the student
 * actually picked.
 */
const saveAnswer = asyncHandler(async (req, res) => {
  const { attempt } = req;
  const resolved = autoFinalizeIfExpired(attempt);
  if (resolved.status !== 'in_progress') {
    throw new ApiError(409, 'Time is up. Your test has already been submitted.');
  }

  const { question_id: questionId } = req.body;
  const rawOptions = req.body.selected_options ?? req.body.selected_option;
  const question = Question.findById(questionId);
  if (!question || question.test_id !== attempt.test_id) {
    throw new ApiError(400, 'Invalid question for this attempt.');
  }

  // `rawOptions` may be null (clear answer), a single letter, or an array.
  const options = normalizeOptionSelection(rawOptions === null || rawOptions === undefined ? [] : rawOptions);
  if (options === null) {
    throw new ApiError(400, 'Invalid selected options.');
  }

  Answer.upsert(attempt.id, questionId, options);
  const remaining = remainingSeconds(attempt.end_at);
  Attempt.updateRemainingTime(attempt.id, remaining);

  res.json({ success: true, data: { remainingTimeSeconds: remaining } });
});

/** POST /api/public/attempts/:attemptId/submit — protected by requireAttemptToken. */
const submitAttempt = asyncHandler(async (req, res) => {
  const finalized = finalizeAttempt(req.params.attemptId);
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

// -- Proctoring ----------------------------------------------------
// Maps a reported violation type to: which counter column on `attempts` to
// increment, whether THIS test has that category of proctoring turned on,
// how many strikes it allows before auto-submitting, and what reason to
// record if it does. `devtools_attempt`/`copy_attempt` are logged for the
// audit trail but never auto-submit on their own — they're best-effort
// deterrents (see frontend/js/security.js), not a reliable proctoring signal.
function violationRules(test) {
  return {
    tab_switch: {
      column: 'tab_switch_count', enforced: !!test.tab_switch_enforced,
      threshold: test.max_tab_switch_violations, reason: 'tab_switch_violation',
    },
    webcam_off: {
      column: 'webcam_violation_count', enforced: !!test.webcam_required,
      threshold: test.max_webcam_violations, reason: 'webcam_violation',
    },
    webcam_permission_denied: {
      column: 'webcam_violation_count', enforced: !!test.webcam_required,
      threshold: test.max_webcam_violations, reason: 'webcam_violation',
    },
    fullscreen_exit: {
      column: 'fullscreen_violation_count', enforced: !!test.fullscreen_required,
      threshold: test.max_fullscreen_violations, reason: 'fullscreen_violation',
    },
    devtools_attempt: {
      column: null, enforced: false, threshold: null, reason: null,
    },
    copy_attempt: {
      column: null, enforced: false, threshold: null, reason: null,
    },
    // NEW (Phase 2, Feature 14): logged by the server when a session is
    // displaced by a newer one; counted for the audit trail but never
    // auto-submits (the newer tab owns the exam).
    multi_tab: {
      column: null, enforced: false, threshold: null, reason: null,
    },
  };
}

const VALID_VIOLATION_TYPES = [
  'tab_switch', 'webcam_off', 'webcam_permission_denied',
  'fullscreen_exit', 'devtools_attempt', 'copy_attempt', 'multi_tab',
];

/** POST /api/public/attempts/:attemptId/violation — report a proctoring event. */
const reportViolation = asyncHandler(async (req, res) => {
  const { attempt } = req;
  const resolved = autoFinalizeIfExpired(attempt);
  if (resolved.status !== 'in_progress') {
    // The attempt already ended for an unrelated reason (e.g. the timer ran
    // out at the same moment) — nothing left to enforce, just acknowledge.
    return res.json({
      success: true,
      data: {
        violationCount: null, threshold: null, autoSubmitted: false, alreadyEnded: true,
      },
    });
  }

  const { type, details } = req.body;
  if (!VALID_VIOLATION_TYPES.includes(type)) {
    throw new ApiError(400, 'Invalid violation type.');
  }

  const test = Test.findById(attempt.test_id);
  Violation.log(attempt.id, type, details ? String(details).slice(0, 500) : null);

  const rule = violationRules(test)[type];
  let violationCount = null;
  let autoSubmitted = false;

  if (rule.column) {
    const updated = Attempt.incrementViolationCount(attempt.id, rule.column);
    violationCount = updated[rule.column];

    if (rule.enforced && rule.threshold && violationCount >= rule.threshold) {
      finalizeAttempt(attempt.id, { reason: rule.reason });
      autoSubmitted = true;
    }
  }

  res.json({ success: true, data: { violationCount, threshold: rule.threshold, autoSubmitted } });
});

module.exports = {
  getTestMeta, startAttempt, getSession, saveAnswer, submitAttempt, reportViolation,
  // Exported for internal use (analytics + review).
  buildSessionPayload,
};
