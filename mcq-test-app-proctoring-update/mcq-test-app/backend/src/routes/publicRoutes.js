const express = require('express');
const {
  getTestMeta, startAttempt, getSession, saveAnswer, submitAttempt, reportViolation,
} = require('../controllers/publicController');
const { requireAttemptToken } = require('../middleware/attemptAuth');

const router = express.Router();

router.get('/tests/:id/meta', getTestMeta);
router.post('/tests/:id/start', startAttempt);

// Session reads are token-aware inside the controller (a fresh page load may
// claim the session by minting a new token). All mutators below require the
// CURRENT token — that is what blocks a second tab (Phase 2, Feature 14).
router.get('/attempts/:attemptId/session', getSession);
router.put('/attempts/:attemptId/answer', requireAttemptToken, saveAnswer);
router.post('/attempts/:attemptId/submit', requireAttemptToken, submitAttempt);
router.post('/attempts/:attemptId/violation', requireAttemptToken, reportViolation);

module.exports = router;
