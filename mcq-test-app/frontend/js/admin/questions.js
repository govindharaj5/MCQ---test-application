import { api } from '../api.js';
import { toast } from '../toast.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { requireAuth, bindLogout } from './guard.js';

requireAuth();
initTheme();
bindThemeToggle();
bindLogout();

const params = new URLSearchParams(location.search);
const testId = params.get('testId');
if (!testId) location.href = '/admin/dashboard.html';

const form = document.getElementById('questionForm');
const errorBanner = document.getElementById('errorBanner');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formTitle = document.getElementById('formTitle');
const questionListContainer = document.getElementById('questionListContainer');
const deleteModal = document.getElementById('deleteModal');

const fields = {
  questionText: document.getElementById('questionText'),
  optionA: document.getElementById('optionA'),
  optionB: document.getElementById('optionB'),
  optionC: document.getElementById('optionC'),
  optionD: document.getElementById('optionD'),
};

let editingQuestionId = null;
let pendingDeleteId = null;
let testTotalQuestions = 0;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}
function clearError() { errorBanner.classList.remove('visible'); }

function resetForm() {
  form.reset();
  editingQuestionId = null;
  formTitle.textContent = 'Add Question';
  submitLabel.textContent = 'Add Question';
  cancelEditBtn.classList.add('hidden');
  clearError();
}

function enterEditMode(q) {
  editingQuestionId = q.id;
  fields.questionText.value = q.question_text;
  fields.optionA.value = q.option_a;
  fields.optionB.value = q.option_b;
  fields.optionC.value = q.option_c;
  fields.optionD.value = q.option_d;
  form.querySelector(`input[name="correctOption"][value="${q.correct_option}"]`).checked = true;
  formTitle.textContent = `Edit Question`;
  submitLabel.textContent = 'Save Changes';
  cancelEditBtn.classList.remove('hidden');
  clearError();
  document.getElementById('questionFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadTestInfo() {
  const test = await api.adminGet(`/tests/${testId}`);
  testTotalQuestions = test.total_questions;
  document.getElementById('testTitleHeading').textContent = test.title;
  document.getElementById('testSubtitle').textContent = `${test.marks_per_question} mark(s) per question · ${test.duration_minutes} min duration`;
  document.getElementById('resultsLink').href = `/admin/results.html?testId=${testId}`;

  const link = `${location.origin}/test/${test.id}`;
  document.getElementById('testLinkText').textContent = link;
  document.getElementById('copyLinkBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Test link copied to clipboard.');
    } catch {
      toast.error('Could not copy link. Please copy it manually.');
    }
  };

  return test;
}

function questionItemHtml(q, index) {
  const opts = [
    ['A', q.option_a], ['B', q.option_b], ['C', q.option_c], ['D', q.option_d],
  ];
  return `
    <div class="question-item">
      <div class="question-item-head">
        <span class="question-item-num">Q${index + 1}</span>
        <span class="question-item-text">${escapeHtml(q.question_text)}</span>
        <div class="question-item-actions">
          <button class="btn btn-secondary btn-sm edit-q-btn" data-id="${q.id}">Edit</button>
          <button class="btn btn-danger-ghost btn-sm delete-q-btn" data-id="${q.id}">Delete</button>
        </div>
      </div>
      <div class="question-item-options">
        ${opts.map(([letter, text]) => `
          <div class="opt ${letter === q.correct_option ? 'correct' : ''}">${letter}. ${escapeHtml(text)}</div>
        `).join('')}
      </div>
    </div>
  `;
}

function updateProgress(count) {
  const pct = testTotalQuestions > 0 ? Math.min(100, Math.round((count / testTotalQuestions) * 100)) : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressLabel').textContent = `${count} / ${testTotalQuestions} questions`;
}

let currentQuestions = [];

async function loadQuestions() {
  currentQuestions = await api.adminGet(`/tests/${testId}/questions`);
  updateProgress(currentQuestions.length);

  if (currentQuestions.length === 0) {
    questionListContainer.innerHTML = `
      <div class="card empty-state">
        <p>No questions added yet. Use the form above to add your first question.</p>
      </div>`;
    return;
  }

  questionListContainer.innerHTML = currentQuestions.map(questionItemHtml).join('');

  document.querySelectorAll('.edit-q-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = currentQuestions.find((x) => String(x.id) === btn.dataset.id);
      if (q) enterEditMode(q);
    });
  });
  document.querySelectorAll('.delete-q-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingDeleteId = btn.dataset.id;
      deleteModal.classList.remove('hidden');
    });
  });
}

async function init() {
  try {
    await loadTestInfo();
    await loadQuestions();
  } catch (err) {
    toast.error(err.message);
    questionListContainer.innerHTML = `<div class="card empty-state"><p class="text-danger">${err.message}</p></div>`;
  }
}
init();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const correctInput = form.querySelector('input[name="correctOption"]:checked');
  const payload = {
    question_text: fields.questionText.value.trim(),
    option_a: fields.optionA.value.trim(),
    option_b: fields.optionB.value.trim(),
    option_c: fields.optionC.value.trim(),
    option_d: fields.optionD.value.trim(),
    correct_option: correctInput ? correctInput.value : null,
  };

  if (!payload.question_text || !payload.option_a || !payload.option_b || !payload.option_c || !payload.option_d) {
    return showError('Please fill in the question text and all four options.');
  }
  if (!payload.correct_option) {
    return showError('Please select which option is correct.');
  }

  submitBtn.disabled = true;
  try {
    if (editingQuestionId) {
      await api.adminPut(`/tests/${testId}/questions/${editingQuestionId}`, payload);
      toast.success('Question updated.');
    } else {
      await api.adminPost(`/tests/${testId}/questions`, payload);
      toast.success('Question added.');
    }
    resetForm();
    await loadQuestions();
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

cancelEditBtn.addEventListener('click', resetForm);

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  deleteModal.classList.add('hidden');
  pendingDeleteId = null;
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await api.adminDelete(`/tests/${testId}/questions/${pendingDeleteId}`);
    toast.success('Question deleted.');
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
    await loadQuestions();
  } catch (err) {
    toast.error(err.message);
  }
});
