const express = require('express');
const {
  listQuestions, createQuestion, updateQuestion, deleteQuestion, reorderQuestions,
} = require('../controllers/questionController');

// mergeParams so :testId from the parent router (testRoutes) is available here
const router = express.Router({ mergeParams: true });

router.get('/', listQuestions);
router.post('/', createQuestion);
router.post('/reorder', reorderQuestions); // NEW: drag & drop reorder (Feature 16)
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

module.exports = router;
