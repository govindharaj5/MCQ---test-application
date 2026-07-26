const express = require('express');
const {
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
} = require('../controllers/questionController');

// mergeParams so :testId from the parent router (testRoutes) is available here
const router = express.Router({ mergeParams: true });

router.get('/', listQuestions);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

module.exports = router;
