const express = require('express');
const {
  getTestMeta, startAttempt, getSession, saveAnswer, submitAttempt,
} = require('../controllers/publicController');

const router = express.Router();

router.get('/tests/:id/meta', getTestMeta);
router.post('/tests/:id/start', startAttempt);
router.get('/attempts/:attemptId/session', getSession);
router.put('/attempts/:attemptId/answer', saveAnswer);
router.post('/attempts/:attemptId/submit', submitAttempt);

module.exports = router;
