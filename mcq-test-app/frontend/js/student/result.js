import { api } from '../api.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { formatDateTime, formatDuration, formatNumber } from '../format.js';

initTheme();
bindThemeToggle();

const params = new URLSearchParams(location.search);
const attemptId = params.get('attemptId');

const loadingState = document.getElementById('loadingState');
const resultCard = document.getElementById('resultCard');
const errorState = document.getElementById('errorState');
const RING_CIRCUMFERENCE = 2 * Math.PI * 80;

function showError(message) {
  loadingState.classList.add('hidden');
  errorState.classList.remove('hidden');
  document.getElementById('errorMessage').textContent = message;
}

async function init() {
  if (!attemptId) return showError('No attempt was specified.');

  let session;
  try {
    session = await api.get(`/public/attempts/${attemptId}/session`);
  } catch (err) {
    return showError(err.message);
  }

  const { attempt } = session;

  if (attempt.status === 'in_progress') {
    location.href = `/student/test.html?attemptId=${attemptId}`;
    return;
  }

  loadingState.classList.add('hidden');
  resultCard.classList.remove('hidden');

  document.getElementById('studentNameHeading').textContent = attempt.studentName;
  document.getElementById('scoreValue').textContent = `${formatNumber(attempt.score)} / ${formatNumber(attempt.totalMarks)}`;
  document.getElementById('timeValue').textContent = formatDuration(attempt.timeTakenSeconds || 0);
  document.getElementById('submittedValue').textContent = formatDateTime(attempt.submittedAt);

  const pct = attempt.percentage || 0;
  document.getElementById('pctValue').textContent = `${formatNumber(pct)}%`;
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  const ring = document.getElementById('scoreRingProgress');
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
  // Animate in on next frame for a satisfying fill effect.
  requestAnimationFrame(() => { ring.style.strokeDashoffset = String(offset); });

  if (pct < 40) ring.style.stroke = 'var(--danger)';
  else if (pct < 70) ring.style.stroke = 'var(--warning)';
}

init();
