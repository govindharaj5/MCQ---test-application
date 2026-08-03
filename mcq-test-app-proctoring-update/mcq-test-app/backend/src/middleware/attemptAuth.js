// ============================================================================
// attemptAuth.js (NEW, Phase 2 — Feature 14: multi-tab lock / token reuse)
// ----------------------------------------------------------------------------
// Every student-facing endpoint that mutates or reads an in-progress attempt
// must present the attempt's CURRENT session token (header X-Attempt-Token).
//
// How single-active-session works:
//   1. POST /start issues a token; the browser stores it in sessionStorage
//      (sessionStorage survives a REFRESH of the same tab, but a NEW tab starts
//      with an empty sessionStorage).
//   2. GET /session: if the request carries the current token it's accepted.
//      If it carries NO token (fresh tab / re-opened link), the server issues
//      a NEW token — instantly invalidating the old one. Any other tab still
//      holding the old token receives 409 `session_revoked` on its very next
//      request and is forced out (it can NOT submit the shared attempt; the
//      newer tab owns the exam).
//   3. Mutating endpoints (answer / violation / submit) require a valid token;
//      a stale token gets 409 `session_revoked`.
//
// This also kills token reuse: tokens are 32 random bytes, single-use-per-
// attempt, and are wiped when the attempt is completed.
// ============================================================================
const Attempt = require('../models/Attempt');
const { ApiError } = require('./errorHandler');

const TOKEN_HEADER = 'x-attempt-token';

/**
 * Reads the X-Attempt-Token header (also tolerating a ?token= fallback, which
 * the entry page uses to hand the very first token to test.html before any
 * other request is made).
 */
function getToken(req) {
  const header = req.headers[TOKEN_HEADER];
  if (header) return header;
  return req.query.token || null;
}

/**
 * Route middleware for in-progress attempt mutators: rejects requests whose
 * token doesn't match the attempt's current session token.
 */
function requireAttemptToken(req, res, next) {
  const attempt = Attempt.findById(req.params.attemptId);
  if (!attempt) throw new ApiError(404, 'Attempt not found.');
  req.attempt = attempt; // controllers reuse this instead of re-fetching

  // Completed attempts need no token (result page reads are public by design).
  if (attempt.status !== 'in_progress') return next();

  const token = getToken(req);
  if (!token || attempt.session_token !== token) {
    throw new ApiError(
      409,
      'This test session is no longer active. It was probably opened in another tab or window, or the test ended.',
      'session_revoked',
    );
  }
  next();
}

module.exports = { requireAttemptToken, getToken, TOKEN_HEADER };
