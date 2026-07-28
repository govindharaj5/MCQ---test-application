import { api } from '../api.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { formatDateTime } from '../format.js';

initTheme();
bindThemeToggle();

// The test ID is the last path segment of /test/:id
const testId = location.pathname.split('/').filter(Boolean).pop();

const loadingState = document.getElementById('loadingState');
const statusCard = document.getElementById('statusCard');
const entryFormWrap = document.getElementById('entryFormWrap');

const ICONS = {
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  expired: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

function showStatus({ icon, iconClass, title, message, extraHtml = '' }) {
  loadingState.classList.add('hidden');
  entryFormWrap.classList.add('hidden');
  statusCard.classList.remove('hidden');
  document.getElementById('statusIcon').className = `status-icon ${iconClass}`;
  document.getElementById('statusIcon').innerHTML = ICONS[icon];
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusMessage').textContent = message;
  document.getElementById('statusExtra').innerHTML = extraHtml;
}

function showEntryForm(meta) {
  loadingState.classList.add('hidden');
  statusCard.classList.add('hidden');
  entryFormWrap.classList.remove('hidden');

  document.getElementById('entryTestTitle').textContent = meta.title;
  document.getElementById('entryTestDescription').textContent = meta.description || '';
  document.getElementById('infoQuestions').textContent = meta.questionCount;
  document.getElementById('infoDuration').textContent = `${meta.durationMinutes} min`;
  document.getElementById('infoMarks').textContent = meta.marksPerQuestion;
}

function isValidMobile(v) { return /^\+?\d{7,15}$/.test(v.trim()); }

async function init() {
  if (!testId) {
    showStatus({ icon: 'info', iconClass: 'icon-info', title: 'Test not found', message: 'No test ID was provided in this link.' });
    return;
  }

  let meta;
  try {
    meta = await api.get(`/public/tests/${testId}/meta`);
  } catch (err) {
    showStatus({ icon: 'info', iconClass: 'icon-info', title: 'Test not found', message: err.message });
    return;
  }

  if (meta.availability === 'not_started') {
    showStatus({
      icon: 'wait',
      iconClass: 'icon-wait',
      title: 'Test has not started yet.',
      message: `This test opens on ${formatDateTime(meta.startTime)}. Please come back then.`,
    });
    return;
  }
  if (meta.availability === 'expired') {
    showStatus({
      icon: 'expired',
      iconClass: 'icon-expired',
      title: 'This test has expired.',
      message: `This test closed on ${formatDateTime(meta.endTime)} and can no longer be attempted.`,
    });
    return;
  }
  if (meta.availability === 'inactive') {
    showStatus({
      icon: 'info',
      iconClass: 'icon-info',
      title: 'Test unavailable',
      message: 'This test is not currently available. Please contact the administrator.',
    });
    return;
  }
  if (meta.questionCount === 0) {
    showStatus({
      icon: 'info',
      iconClass: 'icon-info',
      title: 'Test not ready',
      message: 'This test has no questions yet. Please check back later.',
    });
    return;
  }

  showEntryForm(meta);
}

document.getElementById('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBanner = document.getElementById('errorBanner');
  errorBanner.classList.remove('visible');

  const studentName = document.getElementById('studentName').value.trim();
  const collegeName = document.getElementById('collegeName').value.trim();
  const designation = document.getElementById('designation').value.trim();

  if (!studentName || !collegeName || !designation) {
    errorBanner.textContent = 'Please fill in all fields.';
    errorBanner.classList.add('visible');
    return;
  }
  if (!designation) {
    errorBanner.textContent = 'Please select a designation.';
    errorBanner.classList.add('visible');
    return;
}

  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  submitBtn.disabled = true;
  submitLabel.innerHTML = '<span class="spinner"></span> Starting…';

  try {
    const session = await api.post(`/public/tests/${testId}/start`, {
      student_name: studentName,
      register_number: collegeName,
      mobile_number: designation,
    });
    location.href = `/student/test.html?attemptId=${session.attempt.id}`;
  } catch (err) {
    if (err.message.toLowerCase().includes('already attempted')) {
      showStatus({
        icon: 'done',
        iconClass: 'icon-done',
        title: 'Already Attempted',
        message: err.message,
      });
    } else {
      errorBanner.textContent = err.message;
      errorBanner.classList.add('visible');
      submitBtn.disabled = false;
      submitLabel.textContent = 'Start Test';
    }
  }
});

init();
