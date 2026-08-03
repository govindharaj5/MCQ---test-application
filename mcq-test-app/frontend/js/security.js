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
  { key: 'F12' },
  { key: 'I', ctrl: true, shift: true }, // DevTools (Chrome/Edge)
  { key: 'J', ctrl: true, shift: true }, // DevTools console
  { key: 'C', ctrl: true, shift: true }, // Inspect element
  { key: 'U', ctrl: true },              // View source
  { key: 'S', ctrl: true },              // Save page
  { key: 'P', ctrl: true },              // Print
];

function comboMatches(event, combo) {
  const keyMatches = event.key?.toUpperCase() === combo.key.toUpperCase();
  const ctrlMatches = combo.ctrl ? (event.ctrlKey || event.metaKey) : true;
  const shiftMatches = combo.shift ? event.shiftKey : true;
  return keyMatches && ctrlMatches && shiftMatches;
}

let enabled = false;

function handleKeydown(event) {
  if (BLOCKED_KEY_COMBOS.some((combo) => comboMatches(event, combo))) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleContextMenu(event) { event.preventDefault(); }
function handleCopyCutPaste(event) { event.preventDefault(); }
function handleSelectStart(event) { event.preventDefault(); }

/** Activates copy/paste/right-click/selection/devtools-shortcut restrictions. */
export function enableExamSecurity() {
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
  document.body.classList.remove('no-select');
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('contextmenu', handleContextMenu);
  document.removeEventListener('copy', handleCopyCutPaste);
  document.removeEventListener('cut', handleCopyCutPaste);
  document.removeEventListener('paste', handleCopyCutPaste);
  document.removeEventListener('selectstart', handleSelectStart);
}
