// ============================================================================
// shuffle.js (NEW, Phase 2 — Features 9 & 10)
// ----------------------------------------------------------------------------
// Deterministic, per-attempt shuffling of QUESTIONS and OPTIONS.
//
// WHY DETERMINISTIC:
//   Feature 12 (resume on refresh) requires that a student who refreshes the
//   page sees the EXACT SAME question order and option order they saw before —
//   otherwise they'd have to re-read everything and their saved answers would
//   appear to land on different options. Seeding the shuffle from the attempt
//   id (a random, per-student slug) gives:
//     - every student a DIFFERENT order (Feature 9/10),
//     - the SAME student the SAME order on every reload.
//   It also means the admin review page can recompute exactly what the student
//   saw (the shuffled labels), using only the attempt id.
//
// LETTERS ARE INTERNAL, LABELS ARE DISPLAY:
//   A question's options are stored as A/B/C/D (the "stored" letters) and the
//   correct answers are defined in those stored letters. The student sees the
//   options in a shuffled order with display labels A/B/C/D. The mapping
//   { displayLabel -> storedLetter } is what the frontend needs to save
//   answers in the canonical stored letters. Scoring therefore never changes —
//   it compares stored letters against stored letters.
// ============================================================================

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

/** FNV-1a-ish 32-bit string hash — stable across platforms (never Math.random). */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 — tiny, well-known seeded PRNG. Deterministic for a given seed.
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded PRNG. Returns a new array. */
function seededShuffle(items, seed) {
  const result = [...items];
  const rand = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Builds the display mapping for one question's options.
 *
 * Returns an array of 4 entries (always the full A–D set, in shuffled display
 * order), each { label, stored, text }:
 *   label  — what the student sees (A/B/C/D in the shuffled position)
 *   stored — the option's canonical letter in the database
 *   text   — the option text
 *
 * `seed` = hash(attemptId + ':' + questionId) — stable per student+question.
 */
function buildOptionOrder(question, attemptId, shuffleEnabled = true) {
  const storedByLabel = {
    A: question.option_a, B: question.option_b,
    C: question.option_c, D: question.option_d,
  };
  const order = shuffleEnabled
    ? seededShuffle(OPTION_LETTERS, hashString(`${attemptId}:${question.id}`))
    : [...OPTION_LETTERS];

  return order.map((stored, index) => ({
    label: OPTION_LETTERS[index], // display label of the shuffled position
    stored,                        // canonical letter this display position points at
    text: storedByLabel[stored],
  }));
}

/**
 * Shuffles an array of question rows into the per-attempt display order.
 * Seed comes from the attempt id alone, so it is identical on every reload.
 */
function shuffleQuestions(questions, attemptId) {
  return seededShuffle(questions, hashString(`qorder:${attemptId}`));
}

/** Parses a stored comma-joined list ('A,C') into a sorted array ([] when empty). */
function parseOptionList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => OPTION_LETTERS.includes(s))
    .sort();
}

/** Serializes an array of option letters into the canonical sorted list ('A,C'). */
function toOptionList(letters) {
  const unique = [...new Set(letters.map((l) => String(l).toUpperCase()))]
    .filter((l) => OPTION_LETTERS.includes(l))
    .sort();
  return unique.join(',');
}

module.exports = {
  OPTION_LETTERS,
  hashString,
  seededShuffle,
  buildOptionOrder,
  shuffleQuestions,
  parseOptionList,
  toOptionList,
};
