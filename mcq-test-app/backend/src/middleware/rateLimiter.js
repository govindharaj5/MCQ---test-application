// ============================================================================
// Rate limiters — light brute-force protection
// ============================================================================
const rateLimit = require('express-rate-limit');

/** Guards the admin login endpoint against password-guessing. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
});

/** Loose general limiter for public student-facing endpoints. */
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiter, publicLimiter };
