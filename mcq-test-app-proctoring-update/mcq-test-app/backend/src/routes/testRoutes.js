const express = require('express');
const {
  createTest, listTests, getTest, updateTest, deleteTest,
} = require('../controllers/testController');
const {
  listResults, getStats, getAttemptReview, exportCsv, exportXlsx, exportPdf,
} = require('../controllers/resultController');
const questionRoutes = require('./questionRoutes');

const router = express.Router();

router.get('/', listTests);
router.post('/', createTest);
router.get('/:id', getTest);
router.put('/:id', updateTest);
router.delete('/:id', deleteTest);

// Nested question management: /api/tests/:testId/questions
router.use('/:testId/questions', questionRoutes);

// Results, detailed review (Feature 5), analytics, & exports, scoped to a test
router.get('/:testId/results', listResults);
router.get('/:testId/stats', getStats);
router.get('/:testId/attempts/:attemptId/review', getAttemptReview); // NEW: Feature 5
router.get('/:testId/export/csv', exportCsv);
router.get('/:testId/export/xlsx', exportXlsx);
router.get('/:testId/export/pdf', exportPdf); // NEW: Feature 15

module.exports = router;
