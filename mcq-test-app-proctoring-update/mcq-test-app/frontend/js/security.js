// ============================================================================
// security.js — best-effort client-side restrictions for the test-taking page.
// ----------------------------------------------------------------------------
// IMPORTANT / HONEST LIMITATION (also documented in README.md):
// These are deterrents, not a security boundary. Any client-side JS
// restriction can be bypassed by a sufficiently determined user (disabling
// JavaScript, using a browser's remote-debugging protocol, a proxy, or a
// second device to look up answers). The real security is server-side:
// answers are scored from the server's stored correct options, are never
// sent to the browser, and the timer/one-attempt rules are enforced in the
// database — so nothing a student does in the browser can change their score
// or grant a second attempt. This module simply raises the bar for casual
// copying/inspection, per the assignment's requirements.
// ============================================================================

const BLOCKED_KEY_COMBOS = [
  { key: 'F12', reason: 'Developer tools are disabled during this test.' },
  { key: 'I', ctrl: true, shift: true, reason: 'Developer tools are disabled during this test.' }, // DevTools (Chrome/Edge)
  { key: 'J', ctrl: true, shift: true, reason: 'Developer tools are disabled during this test.' }, // DevTools console
  { key: 'C', ctrl: true, shift: true, reason: 'Developer tools are disabled during this test.' }, // Inspect element
  { key: 'U', ctrl: true, reason: 'Viewing page source is disabled during this test.' },
  { key: 'S', ctrl: true, reason: 'Saving the page is disabled during this test.' },
  { key: 'P', ctrl: true, reason: 'Printing is disabled during this test.' },
  { key: 'A', ctrl: true, reason: 'Select-all is disabled during this test.' }, // NEW: Feature 13
];

function comboMatches(event, combo) {
  const keyMatches = event.key?.toUpperCase() === combo.key.toUpperCase();
  const ctrlMatches = combo.ctrl ? (event.ctrlKey || event.metaKey) : true;
  const shiftMatches = combo.shift ? event.shiftKey : true;
  return keyMatches && ctrlMatches && shiftMatches;
}

let enabled = false;
let violationCallback = null;

// NEW: visible warnings — a blocked action calls back into test.js (which
// shows a toast AND logs it to the server) at most once every 2.5s, so
// mashing a blocked key repeatedly doesn't spam the student with 20 toasts.
let lastWarningAt = 0;
function warn(type, reason) {
  const now = Date.now();
  if (now - lastWarningAt < 2500) return;
  lastWarningAt = now;
  if (typeof violationCallback === 'function') violationCallback(type, reason);
}

function handleKeydown(event) {
  const combo = BLOCKED_KEY_COMBOS.find((c) => comboMatches(event, c));
  if (combo) {
    event.preventDefault();
    event.stopPropagation();
    const isDevtools = ['F12', 'I', 'J', 'C'].includes(combo.key) && (combo.key === 'F12' || combo.shift);
    warn(isDevtools ? 'devtools_attempt' : 'copy_attempt', combo.reason);
  }
}

function handleContextMenu(event) {
  event.preventDefault();
  warn('copy_attempt', 'Right-click is disabled during this test.');
}
function handleCopyCutPaste(event) {
  event.preventDefault();
  warn('copy_attempt', 'Copy, cut, and paste are disabled during this test.');
}
function handleSelectStart(event) { event.preventDefault(); }

/**
 * Activates copy/paste/right-click/selection/devtools-shortcut restrictions.
 * `onViolation(type, reason)` (NEW, optional) is called — debounced — whenever
 * a blocked action is attempted, so the caller can show a visible warning
 * toast and/or log the attempt to the server for the admin's audit trail.
 */
export function enableExamSecurity(onViolation) {
  violationCallback = onViolation || null;
  if (enabled) return;
  enabled = true;
  document.body.classList.add('no-select');
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('copy', handleCopyCutPaste);
  document.addEventListener('cut', handleCopyCutPaste);
  document.addEventListener('paste', handleCopyCutPaste);
  document.addEventListener('selectstart', handleSelectStart);
}

/** Restores normal browser behavior (call after the test is submitted). */
export function disableExamSecurity() {
  if (!enabled) return;
  enabled = false;
  violationCallback = null;
  document.body.classList.remove('no-select');
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('contextmenu', handleContextMenu);
  document.removeEventListener('copy', handleCopyCutPaste);
  document.removeEventListener('cut', handleCopyCutPaste);
  document.removeEventListener('paste', handleCopyCutPaste);
  document.removeEventListener('selectstart', handleSelectStart);
}
