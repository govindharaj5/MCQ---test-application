// ============================================================================
// Result controller — admin results table, dashboard stats, and exports
// ============================================================================
const Test = require('../models/Test');
const Attempt = require('../models/Attempt');
const { db } = require('../db');
const { buildCsv, buildXlsx } = require('../utils/exporters');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/** GET /api/tests/:testId/results?search=&status= */
const listResults = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  let attempts = Attempt.findByTestId(req.params.testId);

  const { search, status } = req.query;
  if (status && ['in_progress', 'completed', 'expired'].includes(status)) {
    attempts = attempts.filter((a) => a.status === status);
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

/** GET /api/tests/:testId/stats */
const getStats = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  res.json({ success: true, data: Attempt.stats(req.params.testId) });
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

  res.json({ success: true, data: totals });
});

/** GET /api/tests/:testId/export/csv */
const exportCsv = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempts = Attempt.findByTestId(req.params.testId);
  const csv = buildCsv(attempts);

  const filename = `${test.title.replace(/[^a-z0-9]/gi, '_')}_results.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 CSVs correctly
});

/** GET /api/tests/:testId/export/xlsx */
const exportXlsx = asyncHandler(async (req, res) => {
  const test = Test.findById(req.params.testId);
  if (!test) throw new ApiError(404, 'Test not found.');

  const attempts = Attempt.findByTestId(req.params.testId);
  const buffer = await buildXlsx(attempts, test.title);

  const filename = `${test.title.replace(/[^a-z0-9]/gi, '_')}_results.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = {
  listResults, getStats, getOverview, exportCsv, exportXlsx,
};
