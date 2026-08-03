// ============================================================================
// Timer + scoring calculations
// ============================================================================
// Centralizing this logic (rather than scattering it across controllers)
// means the "refresh-proof timer" and "auto-submit" behavior is defined in
// exactly one place and is easy to reason about / unit test.
// ============================================================================

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
 * Scores an attempt given a map of questionId -> correctOption and
 * questionId -> selectedOption.
 */
function scoreAttempt(correctAnswerMap, studentAnswerMap, marksPerQuestion) {
  let correctCount = 0;
  correctAnswerMap.forEach((correctOption, questionId) => {
    const selected = studentAnswerMap.get(questionId);
    if (selected && selected === correctOption) correctCount += 1;
  });

  const totalQuestions = correctAnswerMap.size;
  const totalMarks = totalQuestions * marksPerQuestion;
  const score = correctCount * marksPerQuestion;
  const percentage = totalMarks > 0 ? (score / totalMarks) * 100 : 0;

  return {
    correctCount,
    totalQuestions,
    score: Math.round(score * 100) / 100,
    totalMarks: Math.round(totalMarks * 100) / 100,
    percentage: Math.round(percentage * 100) / 100,
  };
}

/** Determines a test's availability window state relative to "now". */
function testAvailability(test, now = new Date()) {
  if (!test.is_active) return 'inactive';
  if (now < new Date(test.start_time)) return 'not_started';
  if (now > new Date(test.end_time)) return 'expired';
  return 'live';
}

module.exports = { computeEndAt, remainingSeconds, scoreAttempt, testAvailability };
