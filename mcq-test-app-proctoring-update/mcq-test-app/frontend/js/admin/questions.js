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
const previewModal = document.getElementById('previewModal');

const fields = {
  questionText: document.getElementById('questionText'),
  questionDescription: document.getElementById('questionDescription'),
  optionA: document.getElementById('optionA'),
  optionB: document.getElementById('optionB'),
  optionC: document.getElementById('optionC'),
  optionD: document.getElementById('optionD'),
  points: document.getElementById('pointsInput'),
  imageUrl: document.getElementById('imageUrlInput'),
  videoUrl: document.getElementById('videoUrlInput'),
  validationType: document.getElementById('validationType'),
  validationValue: document.getElementById('validationValue'),
  validationMessage: document.getElementById('validationMessage'),
  required: document.getElementById('requiredToggle'),
  shuffle: document.getElementById('shuffleToggle'),
};

let editingQuestionId = null;
let pendingDeleteId = null;
let testTotalQuestions = 0;
let testMarksPerQuestion = 1;
let currentQuestions = [];

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

// NEW (Phase 2): read which options are ticked as correct.
function getCorrectOptions() {
  return [...form.querySelectorAll('input[name="correctOption"]:checked')].map((i) => i.value);
}

function resetForm() {
  form.reset();
  fields.validationType.value = '';
  fields.validationValue.value = '1';
  fields.validationMessage.value = '';
  fields.required.checked = true;
  fields.shuffle.checked = true;
  editingQuestionId = null;
  formTitle.textContent = 'Add Question';
  submitLabel.textContent = 'Add Question';
  cancelEditBtn.classList.add('hidden');
  clearError();
}

function enterEditMode(q) {
  editingQuestionId = q.id;
  fields.questionText.value = q.question_text;
  fields.questionDescription.value = q.description || '';
  fields.optionA.value = q.option_a;
  fields.optionB.value = q.option_b;
  fields.optionC.value = q.option_c;
  fields.optionD.value = q.option_d;
  fields.points.value = q.points || '';
  fields.imageUrl.value = q.image_url || '';
  fields.videoUrl.value = q.video_url || '';
  fields.required.checked = !!q.is_required;
  fields.shuffle.checked = q.shuffle_options !== 0;

  form.querySelectorAll('input[name="correctOption"]').forEach((i) => { i.checked = false; });
  (q.correct_options || []).forEach((letter) => {
    const input = form.querySelector(`input[name="correctOption"][value="${letter}"]`);
    if (input) input.checked = true;
  });

  if (q.validation && q.validation.type && q.validation.value) {
    fields.validationType.value = q.validation.type;
    fields.validationValue.value = String(q.validation.value);
    fields.validationMessage.value = q.validation.message || '';
  } else {
    fields.validationType.value = '';
    fields.validationValue.value = '1';
    fields.validationMessage.value = '';
  }

  formTitle.textContent = 'Edit Question';
  submitLabel.textContent = 'Save Changes';
  cancelEditBtn.classList.remove('hidden');
  clearError();
  document.getElementById('questionFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadTestInfo() {
  const test = await api.adminGet(`/tests/${testId}`);
  testTotalQuestions = test.total_questions;
  testMarksPerQuestion = Number(test.marks_per_question) || 1;
  document.getElementById('testTitleHeading').textContent = test.title;
  document.getElementById('testSubtitle').textContent = `${test.marks_per_question} mark(s) per question · ${test.duration_minutes} min duration · ${test.pass_percentage}% to pass`;
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

// NEW (Phase 2, Features 7/8): richer question item — shows correct answers,
// points, validation, required flag, with Edit / Duplicate / Preview / Delete.
function questionItemHtml(q, index) {
  const opts = [
    ['A', q.option_a], ['B', q.option_b], ['C', q.option_c], ['D', q.option_d],
  ];
  const correct = q.correct_options || [];
  const chips = [];
  if (correct.length > 1) chips.push(`<span class="badge badge-accent">${correct.length} correct answers</span>`);
  if (q.points) chips.push(`<span class="badge badge-neutral">${q.points} pt</span>`);
  if (q.validation) chips.push(`<span class="badge badge-neutral">${q.validation.type.replace('_', ' ')} ${q.validation.value}</span>`);
  if (q.is_required) chips.push('<span class="badge badge-warning">required</span>');
  return `
    <div class="question-item" draggable="true" data-id="${q.id}">
      <div class="question-item-head">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="question-item-num">Q${index + 1}</span>
        <span class="question-item-text">${escapeHtml(q.question_text)}</span>
        <div class="question-item-actions">
          ${chips.join(' ')}
          <button class="btn btn-secondary btn-sm preview-q-btn" data-id="${q.id}">Preview</button>
          <button class="btn btn-secondary btn-sm duplicate-q-btn" data-id="${q.id}">Duplicate</button>
          <button class="btn btn-secondary btn-sm edit-q-btn" data-id="${q.id}">Edit</button>
          <button class="btn btn-danger-ghost btn-sm delete-q-btn" data-id="${q.id}">Delete</button>
        </div>
      </div>
      <div class="question-item-options">
        ${opts.map(([letter, text]) => `
          <div class="opt ${correct.includes(letter) ? 'correct' : ''}">${letter}. ${escapeHtml(text)}</div>
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

// ---------------------------------------------------------------------------
// NEW (Phase 2, Feature 16): drag & drop reorder. On drop we POST the new
// order to /questions/reorder and reload from the server's canonical order.
// ---------------------------------------------------------------------------
let dragOverId = null;
function bindReorder() {
  document.querySelectorAll('.question-item').forEach((item) => {
    item.addEventListener('dragstart', () => {
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.question-item').forEach((el) => el.classList.remove('drag-over'));
      if (dragOverId && dragOverId !== item.dataset.id) {
        await persistReorder();
      }
      dragOverId = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      dragOverId = item.dataset.id;
      document.querySelectorAll('.question-item').forEach((el) => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', (e) => { e.preventDefault(); });
  });
}

async function persistReorder() {
  try {
    const ids = [...document.querySelectorAll('.question-item')].map((el) => el.dataset.id);
    const updated = await api.adminPost(`/tests/${testId}/questions/reorder`, { orderedIds: ids });
    currentQuestions = updated;
    await loadQuestions();
    toast.success('Question order updated.');
  } catch (err) {
    toast.error(err.message);
    await loadQuestions();
  }
}

// ---------------------------------------------------------------------------
// NEW (Phase 2): live preview — renders the question the way a student sees
// it (single vs multiple answers, description, media, validation rule).
// ---------------------------------------------------------------------------
function openPreview(q) {
  const correct = q.correct_options || [];
  const multi = correct.length > 1;
  const validationText = q.validation
    ? `Select ${q.validation.type.replace('_', ' ')} ${q.validation.value} answer${q.validation.value === 1 ? '' : 's'}.`
    : (multi ? `Select exactly ${correct.length} answers.` : '');
  const media = (q.image_url ? `<img src="${escapeHtml(q.image_url)}" alt="Question image" style="max-width:100%; border-radius:8px; margin-top: var(--space-3);" />` : '')
    + (q.video_url ? `<video src="${escapeHtml(q.video_url)}" controls playsinline preload="metadata" style="max-width:100%; margin-top: var(--space-3);"></video>` : '');

  document.getElementById('previewContent').innerHTML = `
    <div class="preview-q-text">${escapeHtml(q.question_text)}</div>
    ${q.description ? `<div class="preview-q-desc">${escapeHtml(q.description)}</div>` : ''}
    ${media}
    <div class="option-list" style="margin-top: var(--space-4);">
      ${[['A', q.option_a], ['B', q.option_b], ['C', q.option_c], ['D', q.option_d]].map(([letter, text]) => `
        <div class="option"><span class="option-bubble"></span><span class="option-letter">${letter}</span><span class="option-text">${escapeHtml(text)}</span></div>
      `).join('')}
    </div>
    ${q.is_required || validationText ? `<div class="preview-validation">${q.is_required ? 'Required · ' : ''}${validationText}</div>` : ''}
  `;
  previewModal.classList.remove('hidden');
}

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
  bindReorder();

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
  document.querySelectorAll('.preview-q-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = currentQuestions.find((x) => String(x.id) === btn.dataset.id);
      if (q) openPreview(q);
    });
  });
  document.querySelectorAll('.duplicate-q-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const q = currentQuestions.find((x) => String(x.id) === btn.dataset.id);
      if (!q) return;
      try {
        await api.adminPost(`/tests/${testId}/questions`, {
          question_text: q.question_text,
          option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d,
          correct_options: q.correct_options || [],
          answer_count: q.answer_count,
          points: q.points, description: q.description,
          image_url: q.image_url, video_url: q.video_url,
          is_required: q.is_required,
          validation: q.validation,
          shuffle_options: q.shuffle_options,
        });
        toast.success('Question duplicated.');
        await loadQuestions();
      } catch (err) {
        toast.error(err.message);
      }
    });
  });
}

async function init() {
  try {
    await loadTestInfo();
    await loadQuestions();
  } catch (err) {
    toast.error(err.message);
    questionListContainer.innerHTML = `<div class="card empty-state"><p class="text-danger">${escapeHtml(err.message)}</p></div>`;
  }
}
init();

// ---------------------------------------------------------------------------
// Submit — builds the full Google-Forms-style payload.
// ---------------------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const correctOptions = getCorrectOptions();

  const payload = {
    question_text: fields.questionText.value.trim(),
    option_a: fields.optionA.value.trim(),
    option_b: fields.optionB.value.trim(),
    option_c: fields.optionC.value.trim(),
    option_d: fields.optionD.value.trim(),
    correct_options: correctOptions,
    answer_count: correctOptions.length,
    points: fields.points.value === '' ? undefined : Number(fields.points.value),
    description: fields.questionDescription.value.trim() || null,
    image_url: fields.imageUrl.value.trim() || null,
    video_url: fields.videoUrl.value.trim() || null,
    is_required: fields.required.checked,
    shuffle_options: fields.shuffle.checked ? 1 : 0,
  };

  // Validation rule (Feature 8): explicit admin rule wins; otherwise a
  // multi-answer question implies "exactly N" (mirrors backend behavior).
  if (fields.validationType.value) {
    payload.validation = {
      type: fields.validationType.value,
      value: Number(fields.validationValue.value),
      message: fields.validationMessage.value.trim() || null,
    };
  } else if (correctOptions.length > 1) {
    payload.validation = {
      type: 'exact',
      value: correctOptions.length,
      message: `Please select exactly ${correctOptions.length} answers.`,
    };
  } else {
    payload.validation = null;
  }

  if (!payload.question_text || !payload.option_a || !payload.option_b || !payload.option_c || !payload.option_d) {
    return showError('Please fill in the question text and all four options.');
  }
  if (payload.correct_options.length === 0) {
    return showError('Please select at least one correct answer.');
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

document.getElementById('closePreviewBtn').addEventListener('click', () => {
  previewModal.classList.add('hidden');
});
