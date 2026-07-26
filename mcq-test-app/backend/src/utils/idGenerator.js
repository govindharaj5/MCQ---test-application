// ============================================================================
// Generates short, URL-safe random IDs (no external dependency needed).
// Used for test slugs (embedded in the public /test/:id link) and attempt IDs.
// ============================================================================
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no 0/O/1/l/I ambiguity

function generateId(length = 10) {
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i += 1) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

module.exports = { generateId };
