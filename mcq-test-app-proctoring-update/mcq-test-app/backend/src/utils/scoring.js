// ============================================================================
// Timer + scoring calculations
// ============================================================================
// Centralizing this logic (rather than scattering it across controllers)
// means the "refresh-proof timer" and "auto-submit" behavior is defined in
// exactly one place and is easy to reason about / unit test.
// ============================================================================
const { parseOptionList } = require('./shuffle');

/**
 * Computes the hard deadline for a new attempt.
 * The attempt gets `duration_minutes` from "now", but can never run past the
 * test's own configured end_time — e.g. a 20-minute test that starts being
 * attempted 5 minutes before the test window closes only gets 5 minutes.
 */
function computeEndAt(now, durationMinutes, testEndTime) {
  const byDuration = new Date(now.getTime() + durationMinutes * 60 * 1000);
  const byTestEnd = new Date(testEndTime);
  return byDuration < byTestEnd ? byDuration : byTestEnd;
}

/** Seconds remaining until `endAt`, floored at 0. */
function remainingSeconds(endAt, now = new Date()) {
  const diffMs = new Date(endAt).getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / 1000));
}

/**
 * Scores an attempt. (Phase 2 — Feature 7: supports multiple correct answers.)
 *
 *   correctAnswerMap : Map<questionId, { correct: string[], points: number }>
 *                      — stored correct letters per question + per-question points
 *   studentAnswerMap : Map<questionId, string[]>  — stored selected letters per question
 *
 * A question is CORRECT only when the student's selection is a non-empty set
 * that exactly matches the correct set. All-or-nothing per question (no
 * partial credit) — same rule as the original single-answer scoring, extended
 * to sets.
 */
function scoreAttempt(correctAnswerMap, studentAnswerMap) {
  let correctCount = 0;
  let score = 0;
  let totalMarks = 0;

  correctAnswerMap.forEach(({ correct, points }, questionId) => {
    totalMarks += points;
    const selected = studentAnswerMap.get(questionId) || [];
    const selectedSet = selected.sort().join(',');
    const correctSet = [...correct].sort().join(',');
    if (selectedSet !== '' && selectedSet === correctSet) {
      correctCount += 1;
      score += points;
    }
  });

  const totalQuestions = correctAnswerMap.size;
  const percentage = totalMarks > 0 ? (score / totalMarks) * 100 : 0;

  return {
    correctCount,
    totalQuestions,
    score: Math.round(score * 100) / 100,
    totalMarks: Math.round(totalMarks * 100) / 100,
    percentage: Math.round(percentage * 100) / 100,
  };
}

/**
 * Normalizes a stored answer value (comma-joined list or single letter) into a
 * sorted array of stored letters — [] when unanswered. Used by every consumer
 * of the `answers` table (scoring, session payloads, review page).
 */
function normalizeSelection(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return parseOptionList(value.join(','));
  return parseOptionList(String(value));
}

/** Determines a test's availability window state relative to "now". */
function testAvailability(test, now = new Date()) {
  if (!test.is_active) return 'inactive';
  if (now < new Date(test.start_time)) return 'not_started';
  if (now > new Date(test.end_time)) return 'expired';
  return 'live';
}

module.exports = {
  computeEndAt, remainingSeconds, scoreAttempt, testAvailability, normalizeSelection,
};
