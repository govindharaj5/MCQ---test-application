const express = require('express');
const {
  createTest, listTests, getTest, updateTest, deleteTest,
} = require('../controllers/testController');
const {
  listResults, getStats, exportCsv, exportXlsx,
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

// Results & export, scoped to a single test
router.get('/:testId/results', listResults);
router.get('/:testId/stats', getStats);
router.get('/:testId/export/csv', exportCsv);
router.get('/:testId/export/xlsx', exportXlsx);

module.exports = router;
