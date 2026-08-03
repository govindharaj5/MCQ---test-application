// ============================================================================
// Result controller — admin results table, dashboard stats, and exports
// ============================================================================
const Test = require('../models/Test');
const Attempt = require('../models/Attempt');
const { db } = require('../db');
const { buildCsv, buildXlsx, buildPdf } = require('../utils/exporters');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { questionAnalytics, attemptReview } = require('../services/analyticsService');

// Derives the admin-facing status label from the existing `status` column plus
// the `submission_reason` column, without changing what `status` itself means
// anywhere else in the app.
function displayStatus(attempt) {
  if (attempt.status === 'in_progress') return 'in_progress';
  if (attempt.submission_reason === 'timeout') return 'auto_submitted';
  if (['tab_switch_violation', 'webcam_violation', 'fullscreen_violation', 'multi_tab'].includes(attempt.submission_reason)) {
    return 'cheating_detected';
  }
  return 'completed';
}

function withDisplayStatus(attempt) {
  return { ...attempt, display_status: displayStatus(attempt) };
}

/** GET /api/tests/:testId/results?search=&status= */
const listResults = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  let attempts = Attempt.findByTestId(req.params.testId).map(withDisplayStatus);

  const { search, status } = req.query;
  // `status` accepts the derived labels ('auto_submitted' / 'cheating_detected')
  // alongside the original raw ones.
  const VALID_STATUS_FILTERS = ['in_progress', 'completed', 'expired', 'auto_submitted', 'cheating_detected'];
  if (status && VALID_STATUS_FILTERS.includes(status)) {
    attempts = attempts.filter((a) => a.status === status || a.display_status === status);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    attempts = attempts.filter(
      (a) => a.student_name.toLowerCase().includes(q)
        || a.register_number.toLowerCase().includes(q)
        || a.mobile_number.toLowerCase().includes(q),
    );
  }

  res.json({ success: true, data: attempts });
});

/**
 * GET /api/tests/:testId/stats
 * Phase 2 (Feature 15): extended with pass/fail split, question-wise accuracy,
 * and the most-wrong / most-correct question.
 */
const getStats = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const passPercentage = test.pass_percentage ?? 40;
  const stats = Attempt.stats(req.params.testId, passPercentage);
  const analytics = questionAnalytics(req.params.testId);

  res.json({
    success: true,
    data: {
      ...stats,
      passPercentage,
      mostWrongQuestion: analytics.mostWrongQuestion,
      mostCorrectQuestion: analytics.mostCorrectQuestion,
      questionWiseAccuracy: analytics.perQuestion,
    },
  });
});

/**
 * GET /api/tests/:testId/attempts/:attemptId/review  (Feature 5)
 * Detailed per-question breakdown: question text, options as the student saw
 * them (deterministic per-attempt shuffle), correct answer, student's answer,
 * correct/wrong, and marks awarded.
 */
const getAttemptReview = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt || attempt.test_id !== req.params.testId) {
    throw new ApiError(404, 'Attempt not found for this test.');
  }
  if (attempt.status === 'in_progress') {
    throw new ApiError(409, 'This attempt is still in progress.');
  }

  const review = attemptReview(attempt);
  res.json({
    success: true,
    data: {
      ...review,
      // Pass threshold for the Pass/Fail badge on the review page (Feature 15).
      passPercentage: test.pass_percentage ?? 40,
      attempt: { ...review.attempt, display_status: displayStatus(review.attempt) },
    },
  });
});

/** GET /api/dashboard/overview — aggregate stats across ALL tests, for the main admin dashboard. */
const getOverview = asyncHandler(async (req, res) => {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tests) AS totalTests,
      (SELECT COUNT(*) FROM attempts) AS totalAttempts,
      (SELECT COUNT(*) FROM attempts WHERE status = 'completed') AS totalCompleted,
      (SELECT COUNT(*) FROM attempts WHERE status = 'in_progress') AS totalInProgress
  `).get();

  // Pass/fail + score aggregates across every completed attempt (Feature 15).
  const marks = db.prepare(`
    SELECT a.score, a.percentage, t.pass_percentage
    FROM attempts a JOIN tests t ON t.id = a.test_id
    WHERE a.status = 'completed' AND a.percentage IS NOT NULL
  `).all();

  let passed = 0;
  let failed = 0;
  let highest = null;
  let lowest = null;
  let sum = 0;
  marks.forEach((m) => {
    const threshold = m.pass_percentage ?? 40;
    if (m.percentage >= threshold) passed += 1;
    else failed += 1;
    const s = Number(m.score);
    if (highest === null || s > highest) highest = s;
    if (lowest === null || s < lowest) lowest = s;
    sum += s;
  });

  res.json({
    success: true,
    data: {
      ...totals,
      totalPassed: passed,
      totalFailed: failed,
      highestScore: highest,
      lowestScore: lowest,
      averageScore: marks.length ? Math.round((sum / marks.length) * 100) / 100 : null,
    },
  });
});

/** GET /api/tests/:testId/export/csv */
const exportCsv = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempts = Attempt.findByTestId(req.params.testId).map(withDisplayStatus);
  const csv = buildCsv(attempts, test.pass_percentage ?? 40);

  const filename = `${test.title.replace(/[^a-z0-9]/gi, '_')}_results.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 CSVs correctly
});

/** GET /api/tests/:testId/export/xlsx */
const exportXlsx = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempts = Attempt.findByTestId(req.params.testId).map(withDisplayStatus);
  const buffer = await buildXlsx(attempts, test.title, test.pass_percentage ?? 40);

  const filename = `${test.title.replace(/[^a-z0-9]/gi, '_')}_results.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

/**
 * GET /api/tests/:testId/export/pdf  (NEW — Feature 15)
 * PDF export: analytics summary + full results table. Generated with pdfkit
 * (pure-JS, no native dependencies — safe for Render/Vercel serverless).
 */
const exportPdf = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempts = Attempt.findByTestId(req.params.testId).map(withDisplayStatus);
  const passPercentage = test.pass_percentage ?? 40;
  const stats = Attempt.stats(req.params.testId, passPercentage);
  const analytics = questionAnalytics(req.params.testId);
  const pdf = await buildPdf(test, attempts, stats, analytics, passPercentage);

  const filename = `${test.title.replace(/[^a-z0-9]/gi, '_')}_results.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

module.exports = {
  listResults, getStats, getAttemptReview, getOverview, exportCsv, exportXlsx, exportPdf,
};
