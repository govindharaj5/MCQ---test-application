// ============================================================================
// Lightweight, dependency-free input validation helpers.
// Each returns true/false; controllers combine these into readable checks
// and produce clear 400 error messages (see middleware/errorHandler.js and
// controllers for the ApiError usage pattern).
// ============================================================================

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

const isValidISODate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;

const isValidOption = (v) => ['A', 'B', 'C', 'D'].includes(v);

/** Accepts digits, optionally with a leading +, 7-15 digits total (loose, international-friendly). */
const isValidMobile = (v) => typeof v === 'string' && /^\+?\d{7,15}$/.test(v.trim());

const isValidUsername = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{3,50}$/.test(v.trim());

module.exports = {
  isNonEmptyString,
  isValidISODate,
  isPositiveNumber,
  isPositiveInteger,
  isValidOption,
  isValidMobile,
  isValidUsername,
};
