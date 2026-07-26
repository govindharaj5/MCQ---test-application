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
 */
function finalizeAttempt(attemptId, { reason = 'manual' } = {}) {
  const attempt = Attempt.findById(attemptId);
  if (!attempt) return null;
  if (attempt.status === 'completed') return attempt;

  const test = Test.findById(attempt.test_id);
  const correctAnswerMap = Question.correctAnswerMap(attempt.test_id);
  const studentAnswerMap = Answer.answerMap(attemptId);

  const { score, totalMarks, percentage } = scoreAttempt(
    correctAnswerMap,
    studentAnswerMap,
    test.marks_per_question,
  );

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
  });
}

/**
 * Checks whether an in-progress attempt's time has expired and, if so,
 * auto-finalizes it. Returns the (possibly updated) attempt.
 */
function autoFinalizeIfExpired(attempt) {
  if (attempt.status !== 'in_progress') return attempt;
  if (remainingSeconds(attempt.end_at) > 0) return attempt;
  return finalizeAttempt(attempt.id, { reason: 'expired' });
}

module.exports = { finalizeAttempt, autoFinalizeIfExpired };
