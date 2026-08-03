// ============================================================================
// analyticsService.js (NEW, Phase 2 — Features 5 & 15)
// ----------------------------------------------------------------------------
// Question-level analytics (most-wrong / most-correct question, per-question
// accuracy) and the per-attempt detailed review used by the admin review page.
//
// All comparison happens in canonical stored letters: a question is CORRECT
// when the student's selected set exactly equals the question's correct set
// (Features 7/9/10 hold regardless of how options were displayed to the
// student — display shuffling never touches the stored letters).
// ============================================================================
const { db } = require('../db');
const Question = require('../models/Question');
const Answer = require('../models/Answer');
const { normalizeOptionSelection } = require('../utils/validators');
const { buildOptionOrder } = require('../utils/shuffle');

/** For one question, decides whether a selection is correct (exact set match). */
function isCorrect(selected, correct) {
  const a = [...(selected || [])].sort().join(',');
  const b = [...(correct || [])].sort().join(',');
  return a !== '' && a === b;
}

/**
 * Question-wise analytics for a completed test:
 *   perQuestion : [{ question_id, question_text, correctCount, wrongCount, accuracyPct }]
 *   mostWrongQuestion / mostCorrectQuestion : the extremes (null when no data)
 * Questions are ranked by their stored order_index for stable display.
 */
function questionAnalytics(testId) {
  const questions = Question.findByTestId(testId); // admin view: includes correct answers
  const attempts = db.prepare(
    "SELECT id FROM attempts WHERE test_id = ? AND status = 'completed'",
  ).all(testId);
  const attemptIds = attempts.map((a) => a.id);

  // All answers for every completed attempt, in one query.
  const rows = attemptIds.length
    ? db.prepare(
      `SELECT attempt_id, question_id, selected_options, selected_option
       FROM answers WHERE attempt_id IN (${attemptIds.map(() => '?').join(',')})`,
    ).all(...attemptIds)
    : [];

  const correctMap = new Map();
  questions.forEach((q) => {
    correctMap.set(q.id, normalizeOptionSelection(q.correct_options || q.correct_option));
  });

  // count[qid] = { correct, wrong } over all responses
  const counts = new Map();
  rows.forEach((r) => {
    if (!correctMap.has(r.question_id)) return; // question deleted mid-exam; ignore
    const c = counts.get(r.question_id) || { correct: 0, wrong: 0 };
    const selected = normalizeOptionSelection(r.selected_options ?? r.selected_option);
    if (selected.length === 0) return; // unanswered — not correct, not wrong
    if (isCorrect(selected, correctMap.get(r.question_id))) c.correct += 1;
    else c.wrong += 1;
    counts.set(r.question_id, c);
  });

  const perQuestion = questions.map((q) => {
    const c = counts.get(q.id) || { correct: 0, wrong: 0 };
    const answered = c.correct + c.wrong;
    return {
      question_id: q.id,
      question_text: q.question_text,
      correctCount: c.correct,
      wrongCount: c.wrong,
      accuracyPct: answered > 0 ? Math.round((c.correct / answered) * 1000) / 10 : null,
    };
  });

  const withWrong = perQuestion.filter((q) => q.wrongCount > 0);
  const withCorrect = perQuestion.filter((q) => q.correctCount > 0);

  return {
    perQuestion,
    mostWrongQuestion: withWrong.length
      ? withWrong.reduce((a, b) => (b.wrongCount > a.wrongCount ? b : a), withWrong[0])
      : null,
    mostCorrectQuestion: withCorrect.length
      ? withCorrect.reduce((a, b) => (b.correctCount > a.correctCount ? b : a), withCorrect[0])
      : null,
  };
}

/**
 * Detailed per-question review for ONE attempt (Feature 5).
 * Recomputes the deterministic per-attempt shuffle so the admin sees the SAME
 * display labels (A/B/C/D positions) the student actually saw.
 *
 * Returns:
 *   attempt     — the attempt row (plus display_status)
 *   questions   — [{
 *                  question_text, description, image_url, video_url, points,
 *                  options: [{label, stored, text}]  (display order as seen),
 *                  correct:   [labels as seen, e.g. ['B']],
 *                  selected:  [labels as seen] ([] when unanswered),
 *                  isCorrect, marks
 *                }]
 *   summary     — correctCount, wrongCount, unansweredCount, score, totalMarks, percentage
 */
function attemptReview(attempt) {
  const testRow = db.prepare('SELECT * FROM tests WHERE id = ?').get(attempt.test_id);
  const questions = Question.findByTestId(attempt.test_id); // admin view (has correct)
  const answers = Answer.findByAttemptId(attempt.id);

  const answerByQuestion = new Map();
  answers.forEach((a) => answerByQuestion.set(a.question_id, a));

  const correctMap = new Map();
  questions.forEach((q) => {
    correctMap.set(q.id, normalizeOptionSelection(q.correct_options || q.correct_option));
  });

  const defaultPoints = testRow ? testRow.marks_per_question : 1;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  const items = questions.map((q) => {
    const storedCorrect = correctMap.get(q.id) || [];
    const answerRow = answerByQuestion.get(q.id);
    const storedSelected = answerRow
      ? normalizeOptionSelection(answerRow.selected_options ?? answerRow.selected_option)
      : [];
    const points = q.points !== null && q.points !== undefined ? Number(q.points) : defaultPoints;

    // The display order this student saw (deterministic per attempt+question).
    const options = buildOptionOrder(q, attempt.id, q.shuffle_options !== 0);
    const labelOf = new Map(options.map((o) => [o.stored, o.label]));

    const selectedLabels = storedSelected.map((s) => labelOf.get(s) || s);
    const correctLabels = storedCorrect.map((s) => labelOf.get(s) || s);
    const correct = isCorrect(storedSelected, storedCorrect);
    if (storedSelected.length === 0) unansweredCount += 1;
    else if (correct) correctCount += 1;
    else wrongCount += 1;

    return {
      question_id: q.id,
      question_text: q.question_text,
      description: q.description || '',
      image_url: q.image_url || null,
      video_url: q.video_url || null,
      points,
      options,
      correct: correctLabels,
      selected: selectedLabels,
      isCorrect: correct,
      marks: correct ? points : 0,
    };
  });

  return {
    attempt,
    questions: items,
    summary: {
      correctCount,
      wrongCount,
      unansweredCount,
      score: attempt.score,
      totalMarks: attempt.total_marks,
      percentage: attempt.percentage,
    },
  };
}

module.exports = { questionAnalytics, attemptReview, isCorrect };
