import { api } from '../api.js';
import { toast } from '../toast.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { requireAuth, bindLogout } from './guard.js';
import { formatDateTime } from '../format.js';

requireAuth();
initTheme();
bindThemeToggle();
bindLogout();

const overviewStatsEl = document.getElementById('overviewStats');
const testListContainer = document.getElementById('testListContainer');
const deleteModal = document.getElementById('deleteModal');
let pendingDeleteId = null;

const AVAILABILITY_BADGE = {
  live: { label: 'Live', cls: 'badge-success' },
  not_started: { label: 'Upcoming', cls: 'badge-info' },
  expired: { label: 'Ended', cls: 'badge-neutral' },
  inactive: { label: 'Inactive', cls: 'badge-warning' },
};

function icon(name) {
  const icons = {
    questions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 9a3 3 0 1 1 4 2.83V14M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };
  return icons[name] || '';
}

function renderOverview(stats) {
  overviewStatsEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Tests</div><div class="stat-value">${stats.totalTests}</div></div>
    <div class="stat-card"><div class="stat-label">Total Attempts</div><div class="stat-value">${stats.totalAttempts}</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value success">${stats.totalCompleted}</div></div>
    <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value accent">${stats.totalInProgress}</div></div>
  `;
}

function testCardHtml(test) {
  const badge = AVAILABILITY_BADGE[test.availability] || AVAILABILITY_BADGE.inactive;
  const link = `${location.origin}/test/${test.id}`;
  return `
    <div class="card card-hover test-card">
      <div class="card-header">
        <h3 class="test-card-title">${escapeHtml(test.title)}</h3>
        <span class="badge ${badge.cls}">${badge.label}</span>
      </div>
      <div class="test-card-meta">
        <span>${icon('questions')} ${test.question_count}/${test.total_questions} questions</span>
        <span>${icon('clock')} ${test.duration_minutes} min</span>
        <span>${icon('users')} ${test.stats.totalAttended} attended</span>
      </div>
      <p class="text-muted text-sm" style="margin: 0;">Starts ${formatDateTime(test.start_time)}</p>

      <div class="test-card-link">
        <span>${link}</span>
        <button class="btn btn-ghost btn-icon btn-sm copy-link-btn" data-link="${link}" title="Copy link">${icon('copy')}</button>
      </div>

      <div class="test-card-actions">
        <a href="/admin/questions.html?testId=${test.id}" class="btn btn-secondary btn-sm">Questions</a>
        <a href="/admin/results.html?testId=${test.id}" class="btn btn-secondary btn-sm">Results</a>
        <a href="/admin/test-form.html?id=${test.id}" class="btn btn-secondary btn-sm">Edit</a>
        <button class="btn btn-danger-ghost btn-sm delete-btn" data-id="${test.id}" data-title="${escapeHtml(test.title)}">Delete</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderEmptyState() {
  testListContainer.innerHTML = `
    <div class="card empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 9a3 3 0 1 1 4 2.83V14M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
      <h3>No tests yet</h3>
      <p>Create your first MCQ test to get started.</p>
      <a href="/admin/test-form.html" class="btn btn-primary" style="margin-top: var(--space-3);">Create New Test</a>
    </div>
  `;
}

function attachCardListeners() {
  document.querySelectorAll('.copy-link-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.link);
        toast.success('Test link copied to clipboard.');
      } catch {
        toast.error('Could not copy link. Please copy it manually.');
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingDeleteId = btn.dataset.id;
      deleteModal.classList.remove('hidden');
    });
  });
}

async function loadDashboard() {
  try {
    const [stats, tests] = await Promise.all([
      api.adminGet('/dashboard/overview'),
      api.adminGet('/tests'),
    ]);

    renderOverview(stats);

    if (tests.length === 0) {
      renderEmptyState();
    } else {
      testListContainer.innerHTML = `<div class="test-grid">${tests.map(testCardHtml).join('')}</div>`;
      attachCardListeners();
    }
  } catch (err) {
    testListContainer.innerHTML = `<div class="card empty-state"><p class="text-danger">${err.message}</p></div>`;
    toast.error(err.message);
  }
}

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  deleteModal.classList.add('hidden');
  pendingDeleteId = null;
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await api.adminDelete(`/tests/${pendingDeleteId}`);
    toast.success('Test deleted.');
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
    loadDashboard();
  } catch (err) {
    toast.error(err.message);
  }
});

loadDashboard();
