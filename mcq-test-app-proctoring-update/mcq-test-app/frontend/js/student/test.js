import { api } from '../api.js';
import { toast } from '../toast.js';
import { initTheme } from '../theme.js';
import { enableExamSecurity } from '../security.js';
import { formatDuration } from '../format.js';
import {
  initTabSwitchDetection, initFullscreenEnforcement, isFullscreen, requestFullscreen,
  startWebcam, watchWebcamStream,
} from './proctoring.js';

initTheme();

const params = new URLSearchParams(location.search);
const attemptId = params.get('attemptId');
if (!attemptId) location.href = '/';

// ---- State ----
let session = null;          // last full session payload from the server
let currentIndex = 0;        // which question is displayed
// NEW (Phase 2, Feature 7): answers are arrays of canonical option letters,
// e.g. { [questionId]: ['A','C'] }. Single-answer questions simply use arrays
// of length 0 or 1, so one code path handles both radio and checkbox UIs.
let answers = {};            // { [questionId]: ['A'] | ['A','C'] | [] }
let remainingSeconds = 0;
let totalDurationSeconds = 1;
let tickInterval = null;
let resyncInterval = null;
let submitted = false;
let fiveMinWarningShown = false;
const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

// NEW (Phase 2, Feature 14): the single-active-session token. Stored in
// sessionStorage so it survives refreshes but is never shared between tabs.
const TOKEN_KEY = `mcq_attempt_token_${attemptId}`;
let sessionToken = sessionStorage.getItem(TOKEN_KEY) || null;

function rememberToken(token) {
  if (!token) return;
  sessionToken = token;
  sessionStorage.setItem(TOKEN_KEY, token);
}

// Every student-facing request after start carries the session token header.
function attemptHeaders() {
  return sessionToken ? { 'X-Attempt-Token': sessionToken } : {};
}

// NEW: proctoring — active watchers/streams, so they can be torn down cleanly on submit.
let webcamStream = null;
let webcamWatcher = null;
let tabSwitchWatcher = null;
let fullscreenWatcher = null;

const loadingState = document.getElementById('loadingState');
const testShell = document.getElementById('testShell');
const preflightGate = document.getElementById('preflightGate');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// NEW (Phase 2, Feature 14): single point of handling for the 409
// 'session_revoked' error — this tab lost the session to a newer one.
function handleSessionRevoked(message) {
  stopAllProctoring();
  clearInterval(tickInterval);
  clearInterval(resyncInterval);
  window.onbeforeunload = null;
  document.getElementById('sessionRevokedMessage').textContent =
    message || 'This test session was opened in another tab or device. Only one active session is allowed per attempt.';
  document.getElementById('sessionRevokedOverlay').classList.remove('hidden');
}

document.getElementById('sessionReloadBtn').addEventListener('click', () => {
  // A plain reload re-claims the session (the server mints a fresh token when
  // none is sent), displacing whichever tab currently holds it.
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

// ---------------------------------------------------------------------------
// Session loading / rehydration — this single function is what makes the
// test refresh-proof: it re-fetches everything (questions, saved answers,
// remaining time) from the server rather than trusting anything client-side.
// ---------------------------------------------------------------------------
async function loadSession() {
  let payload;
  try {
    payload = await api.get(`/public/attempts/${attemptId}/session`, { headers: attemptHeaders() });
  } catch (err) {
    if (err.code === 'session_revoked') {
      handleSessionRevoked(err.message);
      return false;
    }
    throw err;
  }
  session = payload;
  // The server always echoes the active token in the payload (or mints a new
  // one when this was a fresh load) — adopt it so subsequent calls pass auth.
  rememberToken(session.attempt.sessionToken);

  if (session.attempt.status !== 'in_progress') {
    location.href = `/student/result.html?attemptId=${attemptId}`;
    return false;
  }

  answers = { ...session.answers };
  remainingSeconds = session.remainingTimeSeconds;
  totalDurationSeconds = Math.max(
    1,
    Math.round((new Date(session.attempt.endAt) - new Date(session.attempt.startTime)) / 1000),
  );
  return true;
}

function renderShellStatic() {
  document.getElementById('testTitle').textContent = session.test.title;
  document.getElementById('studentInfo').textContent =
    `${session.attempt.studentName} · ${session.attempt.registerNumber}`;
  document.getElementById('qTotalNum').textContent = session.questions.length;

  document.getElementById('paletteGrid').innerHTML = session.questions
    .map((q, i) => `<button class="palette-item" data-index="${i}" type="button">${i + 1}</button>`)
    .join('');

  document.querySelectorAll('.palette-item').forEach((btn) => {
    btn.addEventListener('click', () => renderQuestion(parseInt(btn.dataset.index, 10)));
  });
}

function renderPalette() {
  document.querySelectorAll('.palette-item').forEach((btn, i) => {
    const q = session.questions[i];
    btn.classList.toggle('answered', !!answers[q.id]?.length);
    btn.classList.toggle('current', i === currentIndex);
  });
}

// NEW (Phase 2, Features 8/9/10): evaluates a question's validation rule
// against the student's current selection. Returns null when valid, or a
// human-readable message when the selection violates the rule.
function validationError(q, selected) {
  if (!q.validation) return null;
  const count = selected.length;
  const { type, value } = q.validation;
  let fails = false;
  if (type === 'exact') fails = count !== value;
  else if (type === 'at_least') fails = count < value;
  else if (type === 'at_most') fails = count > value;

  if (!fails) return null;
  return q.validation.message ||
    (type === 'exact'
      ? `Please select exactly ${value} answer${value === 1 ? '' : 's'}.`
      : type === 'at_least'
        ? `Please select at least ${value} answer${value === 1 ? '' : 's'}.`
        : `Please select at most ${value} answer${value === 1 ? '' : 's'}.`);
}

function renderQuestion(index) {
  currentIndex = Math.max(0, Math.min(index, session.questions.length - 1));
  const q = session.questions[currentIndex];
  const selected = answers[q.id] || [];
  const multi = q.answerCount > 1;

  document.getElementById('qCurrentNum').textContent = currentIndex + 1;
  document.getElementById('qMarks').textContent = `${q.points} point(s)`;
  document.getElementById('qText').textContent = q.question_text;
  document.getElementById('qMultiBadge').classList.toggle('hidden', !multi);

  // NEW (Phase 2, Features 8/9/10): optional description + image/video media.
  const descEl = document.getElementById('qDescription');
  descEl.textContent = q.description || '';
  descEl.classList.toggle('hidden', !q.description);

  const mediaEl = document.getElementById('qMedia');
  let mediaHtml = '';
  if (q.image_url) mediaHtml += `<img src="${escapeHtml(q.image_url)}" alt="Question image" />`;
  if (q.video_url) mediaHtml += `<video src="${escapeHtml(q.video_url)}" controls playsinline preload="metadata"></video>`;
  mediaEl.innerHTML = mediaHtml;
  mediaEl.classList.toggle('hidden', !mediaHtml);

  // NEW (Phase 2, Features 5/9): options arrive pre-shuffled from the server
  // ({ label, stored, text }), so the display letters differ per student but
  // the saved letters remain canonical A–D.
  document.getElementById('optionList').innerHTML = q.options.map((opt) => {
    const isSelected = selected.includes(opt.stored);
    return `
    <div class="option ${isSelected ? 'selected' : ''}" data-stored="${opt.stored}" data-qid="${q.id}" tabindex="0" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${isSelected}">
      <span class="option-bubble"></span>
      <span class="option-letter">${opt.label}</span>
      <span class="option-text">${escapeHtml(opt.text)}</span>
    </div>
  `;
  }).join('');

  document.querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => toggleOption(q.id, el.dataset.stored));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOption(q.id, el.dataset.stored); }
    });
  });

  // Show any inline validation feedback for the current selection.
  const errEl = document.getElementById('qValidationError');
  const err = validationError(q, selected);
  errEl.textContent = err || '';
  errEl.classList.toggle('hidden', !err);

  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === session.questions.length - 1;

  renderPalette();
}

// NEW (Phase 2, Features 5/7/8/9): toggles a selection. Single-answer
// questions behave exactly like the old radio UI; multi-answer questions
// toggle checkboxes. Clearing the last checkbox saves an empty selection.
function toggleOption(questionId, storedLetter) {
  const q = session.questions.find((qq) => qq.id === questionId);
  const multi = q.answerCount > 1;
  const current = answers[questionId] || [];

  let next;
  if (multi) {
    next = current.includes(storedLetter)
      ? current.filter((l) => l !== storedLetter)
      : [...current, storedLetter];
  } else {
    next = current.includes(storedLetter) ? [] : [storedLetter];
  }

  answers[questionId] = next;
  renderQuestion(currentIndex);
  saveAnswer(questionId, next);
}

// ---------------------------------------------------------------------------
// Autosave — saves immediately on selection (best UX) with the autosave
// indicator reflecting real request state, satisfying "auto-save every few
// seconds" via always-fresh saves rather than a fixed-interval batch.
// ---------------------------------------------------------------------------
let saveQueue = Promise.resolve();
function setAutosaveStatus(status) {
  const text = document.getElementById('autosaveText');
  const dot = document.querySelector('#autosaveIndicator .dot');
  if (status === 'saving') {
    text.textContent = 'Saving…';
    dot.style.background = 'var(--warning)';
  } else if (status === 'saved') {
    text.textContent = 'All answers saved';
    dot.style.background = 'var(--success)';
  } else {
    text.textContent = 'Save failed — retrying';
    dot.style.background = 'var(--danger)';
  }
}

// NEW (Phase 2, Feature 14): every save is authenticated with the session token.
function saveAnswer(questionId, letters) {
  setAutosaveStatus('saving');
  // Chain saves so rapid clicks don't race each other out of order.
  saveQueue = saveQueue.then(() =>
    api.put(`/public/attempts/${attemptId}/answer`, {
      question_id: questionId,
      selected_options: letters,
    }, { headers: attemptHeaders() })
      .then(() => setAutosaveStatus('saved'))
      .catch((err) => {
        if (err.code === 'session_revoked') { handleSessionRevoked(err.message); return; }
        setAutosaveStatus('error');
        if (err.message.toLowerCase().includes('time is up')) {
          handleTimeUp();
        }
      }),
  );
}

// ---------------------------------------------------------------------------
// NEW: Proctoring — reporting violations to the server and reacting to the
// response (show a warning, or auto-submit if the test's configured
// threshold has been reached). This is the single funnel every violation
// source (tab-switch, webcam, fullscreen, blocked copy/devtools attempts)
// reports through.
// ---------------------------------------------------------------------------
function stopAllProctoring() {
  if (tabSwitchWatcher) tabSwitchWatcher.stop();
  if (fullscreenWatcher) fullscreenWatcher.stop();
  if (webcamWatcher) webcamWatcher.stop();
  if (webcamStream) webcamStream.getTracks().forEach((t) => t.stop());
}

const VIOLATION_LABELS = {
  tab_switch: 'You switched away from the test tab or window.',
  webcam_off: 'Your webcam feed was lost.',
  webcam_permission_denied: 'Webcam access was turned off.',
  fullscreen_exit: 'You exited fullscreen mode.',
};

async function reportViolation(type, details) {
  if (submitted) return;
  try {
    const result = await api.post(`/public/attempts/${attemptId}/violation`, { type, details }, { headers: attemptHeaders() });

    if (result.autoSubmitted) {
      handleAutoSubmit(
        'Cheating Detected',
        `${VIOLATION_LABELS[type] || 'A test integrity rule was broken.'} This test has reached its violation limit and is being submitted automatically.`,
      );
      return;
    }

    // Only tab-switch/webcam/fullscreen carry a numeric threshold; blocked
    // copy/devtools attempts (handled by security.js) are logged but don't
    // count toward an auto-submit threshold, so just show a lightweight toast.
    if (result.violationCount !== null && result.threshold) {
      showViolationWarning(type, result.violationCount, result.threshold);
    } else if (VIOLATION_LABELS[type] === undefined) {
      toast.warning(details || 'That action is disabled during this test.');
    }
  } catch (err) {
    if (err.code === 'session_revoked') { handleSessionRevoked(err.message); return; }
    // If the attempt already ended server-side for an unrelated reason
    // (e.g. the timer ran out at the same moment), just resync normally.
    if (err.message.toLowerCase().includes('time is up')) handleAutoSubmit('Time\'s Up!', 'Your test is being submitted automatically…');
  }
}

function showViolationWarning(type, count, threshold) {
  document.getElementById('violationTitle').textContent = `Warning ${count} of ${threshold}`;
  document.getElementById('violationMessage').textContent =
    `${VIOLATION_LABELS[type] || 'A test integrity rule was broken.'} Reaching ${threshold} warnings will automatically submit your test.`;
  document.getElementById('violationModal').classList.remove('hidden');
}

document.getElementById('acknowledgeViolationBtn').addEventListener('click', async () => {
  document.getElementById('violationModal').classList.add('hidden');
  // If this was a fullscreen-exit warning, give the student a direct way back in.
  if (session?.test?.proctoring?.fullscreenRequired && !isFullscreen()) {
    try { await requestFullscreen(); } catch { /* user can retry via the same prompt next violation */ }
  }
});

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function updateTimerDisplay() {
  document.getElementById('timerText').textContent = formatDuration(remainingSeconds);

  const offset = RING_CIRCUMFERENCE * (1 - remainingSeconds / totalDurationSeconds);
  document.getElementById('timerRingProgress').style.strokeDashoffset = String(Math.max(0, offset));

  const warningThreshold = Math.min(300, totalDurationSeconds * 0.25);
  const dangerThreshold = Math.min(60, totalDurationSeconds * 0.1);
  const wrap = document.getElementById('timerRingWrap');
  const bar = document.getElementById('timerBar');
  wrap.className = 'timer-ring-wrap';
  bar.className = 'timer-bar';
  if (remainingSeconds <= dangerThreshold) {
    wrap.classList.add('danger'); bar.classList.add('danger');
  } else if (remainingSeconds <= warningThreshold) {
    wrap.classList.add('warning'); bar.classList.add('warning');
  }
}

function startTicking() {
  updateTimerDisplay();
  tickInterval = setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    updateTimerDisplay();

    // NEW (Feature 11): one-time "5 minutes remaining" warning.
    if (!fiveMinWarningShown && remainingSeconds > 0 && remainingSeconds <= 300) {
      fiveMinWarningShown = true;
      toast.warning('5 minutes remaining!');
    }

    if (remainingSeconds <= 0) {
      clearInterval(tickInterval);
      handleTimeUp();
    }
  }, 1000);
}

// Periodically resync with the server: corrects any client clock drift and
// catches the case where the deadline already passed server-side (e.g. tab
// was backgrounded/throttled) so this tab doesn't keep counting down forever.
function startResync() {
  resyncInterval = setInterval(async () => {
    if (submitted) return;
    try {
      const fresh = await api.get(`/public/attempts/${attemptId}/session`, { headers: attemptHeaders() });
      if (fresh.attempt.status !== 'in_progress') {
        handleTimeUp();
        return;
      }
      remainingSeconds = fresh.remainingTimeSeconds;
    } catch (err) {
      if (err.code === 'session_revoked') { handleSessionRevoked(err.message); return; }
      // Silent — a transient network hiccup shouldn't interrupt the exam; the
      // local countdown keeps running and we'll try again next interval.
    }
  }, 15000);
}

// NEW: generalized so both a timeout AND a proctoring violation (reported via
// reportViolation above) can drive this same "auto-submitting…" flow with
// their own title/message, instead of duplicating the submit/redirect logic.
async function handleAutoSubmit(title, message) {
  if (submitted) return;
  submitted = true;
  clearInterval(tickInterval);
  clearInterval(resyncInterval);
  stopAllProctoring();
  window.onbeforeunload = null;
  document.getElementById('autoSubmitTitle').textContent = title;
  document.getElementById('autoSubmitMessage').textContent = message;
  document.getElementById('violationModal').classList.add('hidden');
  document.getElementById('timeUpModal').classList.remove('hidden');
  try {
    await api.post(`/public/attempts/${attemptId}/submit`, {}, { headers: attemptHeaders() });
  } catch (err) {
    if (err.code === 'session_revoked') { handleSessionRevoked(err.message); return; }
    // Even if this request fails, the server auto-finalizes expired attempts
    // on the next read (see backend autoFinalizeIfExpired) — so the score
    // will still be correct on the results page.
  }
  setTimeout(() => { location.href = `/student/result.html?attemptId=${attemptId}`; }, 1400);
}

/** Timer ran out — the original, pre-proctoring auto-submit path. */
function handleTimeUp() {
  return handleAutoSubmit("Time's Up!", 'Your test is being submitted automatically…');
}

// ---------------------------------------------------------------------------
// Navigation & validation (Phase 2, Features 8/9/10): moving to the next
// question is blocked while the CURRENT question has a non-empty selection
// that violates its rule, and the specific message is shown inline.
// ---------------------------------------------------------------------------
function canLeaveCurrentQuestion() {
  const q = session.questions[currentIndex];
  const selected = answers[q.id] || [];
  if (selected.length === 0) return true; // unanswered is never "invalid"
  return !validationError(q, selected);
}

function showInlineValidationError(q) {
  const errEl = document.getElementById('qValidationError');
  errEl.textContent = validationError(q, answers[q.id] || []);
  errEl.classList.remove('hidden');
}

document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentIndex === 0) return;
  renderQuestion(currentIndex - 1);
});
document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentIndex >= session.questions.length - 1) return;
  if (!canLeaveCurrentQuestion()) {
    showInlineValidationError(session.questions[currentIndex]);
    toast.warning('Please complete this question before continuing.');
    return;
  }
  renderQuestion(currentIndex + 1);
});

document.getElementById('submitTestBtn').addEventListener('click', () => {
  const total = session.questions.length;
  const answeredCount = Object.keys(answers).filter((id) => (answers[id] || []).length > 0).length;
  const unanswered = total - answeredCount;

  // NEW (Phase 2, Features 8/9/10): block submit while any question has a
  // selection that violates its rule; jump the student to the first offender.
  const invalidIndex = session.questions.findIndex((q) => !canLeaveQuestion(q));
  if (invalidIndex !== -1) {
    renderQuestion(invalidIndex);
    showInlineValidationError(session.questions[invalidIndex]);
    toast.error('Some answers do not meet the question requirements. Please fix them before submitting.');
    return;
  }

  document.getElementById('submitSummaryText').textContent = unanswered > 0
    ? `You have answered ${answeredCount} of ${total} questions. ${unanswered} question(s) are unanswered. Are you sure you want to submit?`
    : `You have answered all ${total} questions. Ready to submit?`;
  document.getElementById('submitModal').classList.remove('hidden');
});

// NEW (Phase 2, Feature 8/10): shared by the submit gate above; a question
// with a rule only becomes invalid once the student has selected something.
function canLeaveQuestion(q) {
  const selected = answers[q.id] || [];
  if (selected.length === 0) return true;
  return !validationError(q, selected);
}

document.getElementById('cancelSubmitBtn').addEventListener('click', () => {
  document.getElementById('submitModal').classList.add('hidden');
});

document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  submitted = true;
  clearInterval(tickInterval);
  clearInterval(resyncInterval);
  stopAllProctoring();
  window.onbeforeunload = null;

  const btn = document.getElementById('confirmSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting…';

  try {
    await api.post(`/public/attempts/${attemptId}/submit`, {}, { headers: attemptHeaders() });
    location.href = `/student/result.html?attemptId=${attemptId}`;
  } catch (err) {
    if (err.code === 'session_revoked') { handleSessionRevoked(err.message); return; }
    toast.error(err.message);
    location.href = `/student/result.html?attemptId=${attemptId}`;
  }
});

// ---------------------------------------------------------------------------
// NEW: Proctoring pre-flight gate — shown only when this test requires
// webcam and/or fullscreen. Fullscreen in particular MUST be requested from
// a genuine click (browsers silently reject requestFullscreen() called from
// script alone), which is why "Begin Test" is a real button the student
// presses rather than something triggered automatically on page load.
// ---------------------------------------------------------------------------
function runPreflightGate(proctoring) {
  const needsWebcam = proctoring.webcamRequired;
  const needsFullscreen = proctoring.fullscreenRequired;
  if (!needsWebcam && !needsFullscreen) return Promise.resolve();

  loadingState.classList.add('hidden');
  preflightGate.classList.remove('hidden');

  let webcamReady = !needsWebcam;
  let fullscreenReady = !needsFullscreen;
  const beginBtn = document.getElementById('beginTestBtn');
  const errorBanner = document.getElementById('preflightError');

  function updateBeginButton() {
    beginBtn.disabled = !(webcamReady && fullscreenReady);
  }
  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  if (needsWebcam) {
    document.getElementById('preflightWebcamItem').classList.remove('hidden');
    document.getElementById('grantWebcamBtn').addEventListener('click', async () => {
      try {
        webcamStream = await startWebcam(document.getElementById('webcamPreviewSetup'));
        document.getElementById('webcamPreviewSetup').classList.remove('hidden');
        const badge = document.getElementById('webcamStatusBadge');
        badge.textContent = 'Ready'; badge.className = 'badge badge-success';
        document.getElementById('grantWebcamBtn').classList.add('hidden');
        webcamReady = true;
        updateBeginButton();
      } catch (err) {
        const badge = document.getElementById('webcamStatusBadge');
        badge.textContent = 'Denied'; badge.className = 'badge badge-danger';
        showError('Camera access was denied. This test requires webcam access — please allow camera access in your browser and try again.');
        reportViolation('webcam_permission_denied', String(err.message || err).slice(0, 200));
      }
    });
  }

  if (needsFullscreen) {
    document.getElementById('preflightFullscreenItem').classList.remove('hidden');
    document.getElementById('grantFullscreenBtn').addEventListener('click', async () => {
      try {
        await requestFullscreen();
        const badge = document.getElementById('fullscreenStatusBadge');
        badge.textContent = 'Ready'; badge.className = 'badge badge-success';
        document.getElementById('grantFullscreenBtn').classList.add('hidden');
        fullscreenReady = true;
        updateBeginButton();
      } catch {
        showError('Could not enter fullscreen mode. Please try again.');
      }
    });
  }

  return new Promise((resolve) => {
    beginBtn.addEventListener('click', () => {
      preflightGate.classList.add('hidden');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// NEW (Phase 2): back-button guard. The browser Back button normally leaves
// the exam page entirely; instead we push an extra history entry and, when
// the student presses Back, snap straight back onto the page. (beforeunload
// above still warns before any genuine leave.)
// ---------------------------------------------------------------------------
function trapBackButton() {
  history.pushState({ guarded: true }, '');
  window.addEventListener('popstate', () => {
    if (submitted) return;
    history.pushState({ guarded: true }, '');
    toast.warning('Going back is not allowed during the test.');
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  try {
    const ok = await loadSession();
    if (!ok) return;

    const proctoring = session.test.proctoring || {};
    await runPreflightGate(proctoring);

    loadingState.classList.add('hidden');
    testShell.classList.remove('hidden');

    // Visible warnings (Feature 13) for blocked copy/devtools attempts,
    // funneled through the same reportViolation used by tab/webcam/fullscreen.
    enableExamSecurity((type, reason) => reportViolation(type, reason));
    renderShellStatic();
    trapBackButton();

    // Resume at the first unanswered question, for a nicer refresh experience.
    const firstUnanswered = session.questions.findIndex((q) => !(answers[q.id] || []).length);
    renderQuestion(firstUnanswered === -1 ? 0 : firstUnanswered);

    // NEW: activate proctoring watchers now that the gate (if any) has cleared.
    if (proctoring.tabSwitchEnforced) {
      tabSwitchWatcher = initTabSwitchDetection((type, details) => reportViolation(type, details));
    }
    if (proctoring.fullscreenRequired) {
      fullscreenWatcher = initFullscreenEnforcement((type) => reportViolation(type));
    }
    if (proctoring.webcamRequired && webcamStream) {
      const liveVideo = document.getElementById('webcamPreviewLive');
      liveVideo.srcObject = webcamStream;
      liveVideo.classList.remove('hidden');
      webcamWatcher = watchWebcamStream(webcamStream, (type, details) => reportViolation(type, details));
    }

    startTicking();
    startResync();

    window.onbeforeunload = () => 'Your test is still in progress. Are you sure you want to leave?';
  } catch (err) {
    loadingState.innerHTML = `<div class="card status-card"><h2>Unable to load test</h2><p class="text-muted">${escapeHtml(err.message)}</p></div>`;
  }
})();
