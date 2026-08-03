// ============================================================================
// Attempt service — shared logic for finalizing a test attempt
// ============================================================================
// This is called from three places:
//   1. The student explicitly clicks "Submit Test" (public/submit)
//   2. A status/session check discovers time has run out (auto-submit)
//   3. An autosave request discovers time has run out (auto-submit)
// Centralizing it here means "what happens at submission" is defined once.
// ============================================================================
const Test = require('../models/Test');
const Question = require('../models/Question');
const Answer = require('../models/Answer');
const Attempt = require('../models/Attempt');
const { scoreAttempt, remainingSeconds } = require('../utils/scoring');

/**
 * Finalizes an in-progress attempt: scores it and marks it completed.
 * Idempotent — if the attempt is already completed, returns it unchanged.
 *
 * `reason` records WHY the attempt ended and drives the admin dashboard's
 * status label — see frontend/js/admin/results.js:
 *   'manual'                 -> "Completed"      (student clicked Submit)
 *   'timeout'                -> "Auto Submitted" (timer ran out)
 *   '*_violation' / 'multi_tab' -> "Cheating Detected"
 * Defaults to 'manual' so every existing call site that doesn't pass a
 * reason keeps behaving exactly as before.
 *
 * Phase 2 (Features 5/7/15): scoring supports multiple correct answers and
 * per-question points (Question.correctAnswerMap returns {correct, points}).
 */
function finalizeAttempt(attemptId, { reason = 'manual' } = {}) {
  const attempt = Attempt.findById(attemptId);
  if (!attempt) return null;
  if (attempt.status === 'completed') return attempt;

  const test = Test.findById(attempt.test_id);
  const correctMap = Question.correctAnswerMap(attempt.test_id, test.marks_per_question);
  const studentAnswerMap = Answer.answerMap(attemptId);

  const { score, totalMarks, percentage } = scoreAttempt(correctMap, studentAnswerMap);

  const now = new Date();
  const endAt = new Date(attempt.end_at);
  // If finalizing because time ran out, the "true" end moment is the deadline
  // itself, not whenever this request happened to arrive.
  const effectiveEnd = now < endAt ? now : endAt;
  const timeTakenSeconds = Math.max(
    0,
    Math.round((effectiveEnd.getTime() - new Date(attempt.start_time).getTime()) / 1000),
  );

  return Attempt.complete(attemptId, {
    submittedAt: now.toISOString(),
    timeTakenSeconds,
    score,
    totalMarks,
    percentage,
    status: 'completed',
    submissionReason: reason,
  });
}

/**
 * Checks whether an in-progress attempt's time has expired and, if so,
 * auto-finalizes it. Returns the (possibly updated) attempt.
 */
function autoFinalizeIfExpired(attempt) {
  if (attempt.status !== 'in_progress') return attempt;
  if (remainingSeconds(attempt.end_at) > 0) return attempt;
  return finalizeAttempt(attempt.id, { reason: 'timeout' });
}

module.exports = { finalizeAttempt, autoFinalizeIfExpired };
