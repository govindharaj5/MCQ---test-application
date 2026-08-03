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

// NEW (Phase 2, Feature 7): validates an array (or single letter) of option
// selections — distinct letters from A–D only. Returns the normalized array
// when valid, or null when not.
const VALID_OPTIONS = ['A', 'B', 'C', 'D'];
function normalizeOptionSelection(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  if (list.length === 0) return [];
  const normalized = [];
  for (const raw of list) {
    const letter = String(raw).trim().toUpperCase();
    if (letter === '') continue; // empty entry (e.g. cleared answer stored as '') = no selection
    if (!VALID_OPTIONS.includes(letter)) return null;
    if (!normalized.includes(letter)) normalized.push(letter);
  }
  return normalized.sort();
}

// NEW (Phase 2, Feature 8): validates the Google-Forms-style response
// validation rule. Returns { type, value, message } or null when disabled.
function normalizeValidationRule(rule) {
  if (!rule || rule.type === undefined || rule.type === null || rule.type === '') return null;
  const type = String(rule.type);
  if (!['exact', 'at_least', 'at_most'].includes(type)) return null;
  const value = Number.parseInt(rule.value, 10);
  if (!Number.isInteger(value) || value < 1 || value > 4) return null;
  return {
    type,
    value,
    message: typeof rule.message === 'string' && rule.message.trim()
      ? rule.message.trim().slice(0, 200)
      : null,
  };
}

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
  normalizeOptionSelection,
  normalizeValidationRule,
};
