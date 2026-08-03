import { api } from '../api.js';
import { toast } from '../toast.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { requireAuth, bindLogout } from './guard.js';
import { isoToDatetimeLocal, datetimeLocalToIso } from '../format.js';

requireAuth();
initTheme();
bindThemeToggle();
bindLogout();

const params = new URLSearchParams(location.search);
const testId = params.get('id');
const isEditMode = !!testId;

const form = document.getElementById('testForm');
const errorBanner = document.getElementById('errorBanner');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');

const fields = {
  title: document.getElementById('title'),
  description: document.getElementById('description'),
  totalQuestions: document.getElementById('totalQuestions'),
  marksPerQuestion: document.getElementById('marksPerQuestion'),
  durationMinutes: document.getElementById('durationMinutes'),
  // NEW (Phase 2, Feature 15): pass threshold.
  passPercentage: document.getElementById('passPercentage'),
  startTime: document.getElementById('startTime'),
  endTime: document.getElementById('endTime'),
  // NEW: proctoring
  webcamRequired: document.getElementById('webcamRequired'),
  fullscreenRequired: document.getElementById('fullscreenRequired'),
  tabSwitchEnforced: document.getElementById('tabSwitchEnforced'),
  maxWebcamViolations: document.getElementById('maxWebcamViolations'),
  maxFullscreenViolations: document.getElementById('maxFullscreenViolations'),
  maxTabSwitchViolations: document.getElementById('maxTabSwitchViolations'),
};

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLoading(isLoading, label) {
  submitBtn.disabled = isLoading;
  submitLabel.innerHTML = isLoading ? `<span class="spinner"></span> Saving…` : label;
}

function prefillDefaultDates() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5 - (now.getMinutes() % 5), 0, 0); // round up to next 5 min
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 hours
  fields.startTime.value = isoToDatetimeLocal(now.toISOString());
  fields.endTime.value = isoToDatetimeLocal(end.toISOString());
}

async function loadForEdit() {
  document.getElementById('pageTitle').textContent = 'Edit Test — Online Test Platform';
  document.getElementById('formHeading').textContent = 'Edit Test';
  document.getElementById('breadcrumbCurrent').textContent = 'Edit Test';
  submitLabel.textContent = 'Save Changes';

  try {
    const test = await api.adminGet(`/tests/${testId}`);
    fields.title.value = test.title;
    fields.description.value = test.description || '';
    fields.totalQuestions.value = test.total_questions;
    fields.marksPerQuestion.value = test.marks_per_question;
    fields.durationMinutes.value = test.duration_minutes;
    fields.passPercentage.value = test.pass_percentage ?? 40;
    fields.startTime.value = isoToDatetimeLocal(test.start_time);
    fields.endTime.value = isoToDatetimeLocal(test.end_time);
    // NEW: proctoring — reflect this test's current opt-in settings.
    fields.webcamRequired.checked = !!test.webcam_required;
    fields.fullscreenRequired.checked = !!test.fullscreen_required;
    fields.tabSwitchEnforced.checked = !!test.tab_switch_enforced;
    fields.maxWebcamViolations.value = test.max_webcam_violations;
    fields.maxFullscreenViolations.value = test.max_fullscreen_violations;
    fields.maxTabSwitchViolations.value = test.max_tab_switch_violations;
  } catch (err) {
    toast.error(err.message);
    setTimeout(() => { location.href = '/admin/dashboard.html'; }, 1200);
  }
}

if (isEditMode) {
  loadForEdit();
} else {
  prefillDefaultDates();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBanner.classList.remove('visible');

  const payload = {
    title: fields.title.value.trim(),
    description: fields.description.value.trim(),
    total_questions: parseInt(fields.totalQuestions.value, 10),
    marks_per_question: parseFloat(fields.marksPerQuestion.value),
    duration_minutes: parseInt(fields.durationMinutes.value, 10),
    start_time: datetimeLocalToIso(fields.startTime.value),
    end_time: datetimeLocalToIso(fields.endTime.value),
    // NEW (Phase 2, Feature 15): pass threshold (0–100), default 40.
    pass_percentage: parseInt(fields.passPercentage.value, 10) || 40,
    // NEW: proctoring — each rule is independently opt-in; "enabled" is
    // implied by any one of the three being on, useful for quick dashboard checks.
    webcam_required: fields.webcamRequired.checked,
    fullscreen_required: fields.fullscreenRequired.checked,
    tab_switch_enforced: fields.tabSwitchEnforced.checked,
    proctoring_enabled: fields.webcamRequired.checked || fields.fullscreenRequired.checked || fields.tabSwitchEnforced.checked,
    max_webcam_violations: parseInt(fields.maxWebcamViolations.value, 10) || 2,
    max_fullscreen_violations: parseInt(fields.maxFullscreenViolations.value, 10) || 2,
    max_tab_switch_violations: parseInt(fields.maxTabSwitchViolations.value, 10) || 3,
  };

  if (!payload.title) return showError('Please enter a test name.');
  if (!payload.start_time || !payload.end_time) return showError('Please set both start and end date/time.');
  if (new Date(payload.end_time) <= new Date(payload.start_time)) {
    return showError('End date & time must be after the start date & time.');
  }
  if (payload.pass_percentage < 0 || payload.pass_percentage > 100) {
    return showError('Pass percentage must be between 0 and 100.');
  }

  setLoading(true, isEditMode ? 'Save Changes' : 'Save & Continue to Questions');
  try {
    if (isEditMode) {
      await api.adminPut(`/tests/${testId}`, payload);
      toast.success('Test updated successfully.');
      location.href = '/admin/dashboard.html';
    } else {
      const created = await api.adminPost('/tests', payload);
      toast.success('Test created. Now add your questions.');
      location.href = `/admin/questions.html?testId=${created.id}`;
    }
  } catch (err) {
    showError(err.message);
    setLoading(false, isEditMode ? 'Save Changes' : 'Save & Continue to Questions');
  }
});
