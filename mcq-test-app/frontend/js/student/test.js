import { api } from '../api.js';
import { toast } from '../toast.js';
import { initTheme } from '../theme.js';
import { enableExamSecurity } from '../security.js';
import { formatDuration } from '../format.js';

initTheme();

const params = new URLSearchParams(location.search);
const attemptId = params.get('attemptId');
if (!attemptId) location.href = '/';

// ---- State ----
let session = null;          // last full session payload from the server
let currentIndex = 0;        // which question is displayed
let answers = {};            // { [questionId]: 'A'|'B'|'C'|'D' }
let remainingSeconds = 0;
let totalDurationSeconds = 1;
let tickInterval = null;
let resyncInterval = null;
let submitted = false;
const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

const loadingState = document.getElementById('loadingState');
const testShell = document.getElementById('testShell');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Session loading / rehydration — this single function is what makes the
// test refresh-proof: it re-fetches everything (questions, saved answers,
// remaining time) from the server rather than trusting anything client-side.
// ---------------------------------------------------------------------------
async function loadSession() {
  session = await api.get(`/public/attempts/${attemptId}/session`);

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
    btn.classList.toggle('answered', !!answers[q.id]);
    btn.classList.toggle('current', i === currentIndex);
  });
}

function renderQuestion(index) {
  currentIndex = Math.max(0, Math.min(index, session.questions.length - 1));
  const q = session.questions[currentIndex];

  document.getElementById('qCurrentNum').textContent = currentIndex + 1;
  document.getElementById('qMarks').textContent = `${session.test.marksPerQuestion} mark(s)`;
  document.getElementById('qText').textContent = q.question_text;

  const options = [
    ['A', q.option_a], ['B', q.option_b], ['C', q.option_c], ['D', q.option_d],
  ];
  const selected = answers[q.id];

  document.getElementById('optionList').innerHTML = options.map(([letter, text]) => `
    <div class="option ${selected === letter ? 'selected' : ''}" data-letter="${letter}" data-qid="${q.id}" tabindex="0" role="radio" aria-checked="${selected === letter}">
      <span class="option-bubble"></span>
      <span class="option-letter">${letter}</span>
      <span class="option-text">${escapeHtml(text)}</span>
    </div>
  `).join('');

  document.querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => selectOption(q.id, el.dataset.letter));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(q.id, el.dataset.letter); }
    });
  });

  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === session.questions.length - 1;

  renderPalette();
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

function selectOption(questionId, letter) {
  answers[questionId] = letter;
  renderQuestion(currentIndex);

  setAutosaveStatus('saving');
  // Chain saves so rapid clicks don't race each other out of order.
  saveQueue = saveQueue.then(() =>
    api.put(`/public/attempts/${attemptId}/answer`, { question_id: questionId, selected_option: letter })
      .then(() => setAutosaveStatus('saved'))
      .catch((err) => {
        setAutosaveStatus('error');
        if (err.message.toLowerCase().includes('time is up')) {
          handleTimeUp();
        }
      }),
  );
}

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
      const fresh = await api.get(`/public/attempts/${attemptId}/session`);
      if (fresh.attempt.status !== 'in_progress') {
        handleTimeUp();
        return;
      }
      remainingSeconds = fresh.remainingTimeSeconds;
    } catch {
      // Silent — a transient network hiccup shouldn't interrupt the exam; the
      // local countdown keeps running and we'll try again next interval.
    }
  }, 15000);
}

async function handleTimeUp() {
  if (submitted) return;
  submitted = true;
  clearInterval(tickInterval);
  clearInterval(resyncInterval);
  window.onbeforeunload = null;
  document.getElementById('timeUpModal').classList.remove('hidden');
  try {
    await api.post(`/public/attempts/${attemptId}/submit`, {});
  } catch {
    // Even if this request fails, the server auto-finalizes expired attempts
    // on the next read (see backend autoFinalizeIfExpired) — so the score
    // will still be correct on the results page.
  }
  setTimeout(() => { location.href = `/student/result.html?attemptId=${attemptId}`; }, 1400);
}

// ---------------------------------------------------------------------------
// Manual submit
// ---------------------------------------------------------------------------
document.getElementById('prevBtn').addEventListener('click', () => renderQuestion(currentIndex - 1));
document.getElementById('nextBtn').addEventListener('click', () => renderQuestion(currentIndex + 1));

document.getElementById('submitTestBtn').addEventListener('click', () => {
  const total = session.questions.length;
  const answeredCount = Object.keys(answers).length;
  const unanswered = total - answeredCount;
  document.getElementById('submitSummaryText').textContent = unanswered > 0
    ? `You have answered ${answeredCount} of ${total} questions. ${unanswered} question(s) are unanswered. Are you sure you want to submit?`
    : `You have answered all ${total} questions. Ready to submit?`;
  document.getElementById('submitModal').classList.remove('hidden');
});

document.getElementById('cancelSubmitBtn').addEventListener('click', () => {
  document.getElementById('submitModal').classList.add('hidden');
});

document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  submitted = true;
  clearInterval(tickInterval);
  clearInterval(resyncInterval);
  window.onbeforeunload = null;

  const btn = document.getElementById('confirmSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting…';

  try {
    await api.post(`/public/attempts/${attemptId}/submit`, {});
    location.href = `/student/result.html?attemptId=${attemptId}`;
  } catch (err) {
    toast.error(err.message);
    location.href = `/student/result.html?attemptId=${attemptId}`;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  try {
    const ok = await loadSession();
    if (!ok) return;

    loadingState.classList.add('hidden');
    testShell.classList.remove('hidden');

    enableExamSecurity();
    renderShellStatic();

    // Resume at the first unanswered question, for a nicer refresh experience.
    const firstUnanswered = session.questions.findIndex((q) => !answers[q.id]);
    renderQuestion(firstUnanswered === -1 ? 0 : firstUnanswered);

    startTicking();
    startResync();

    window.onbeforeunload = () => 'Your test is still in progress. Are you sure you want to leave?';
  } catch (err) {
    loadingState.innerHTML = `<div class="card status-card"><h2>Unable to load test</h2><p class="text-muted">${err.message}</p></div>`;
  }
})();
