import { api, downloadAuthenticated } from '../api.js';
import { toast } from '../toast.js';
import { initTheme, bindThemeToggle } from '../theme.js';
import { requireAuth, bindLogout } from './guard.js';
import { formatDateTime, formatDuration, formatNumber } from '../format.js';

requireAuth();
initTheme();
bindThemeToggle();
bindLogout();

const params = new URLSearchParams(location.search);
const testId = params.get('testId');
if (!testId) location.href = '/admin/dashboard.html';

const statsGrid = document.getElementById('statsGrid');
const tableContainer = document.getElementById('resultsTableContainer');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderStats(stats) {
  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Attended</div><div class="stat-value">${stats.totalAttended}</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value success">${stats.completedCount}</div></div>
    <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value accent">${stats.inProgressCount}</div></div>
    <div class="stat-card"><div class="stat-label">Highest Score</div><div class="stat-value">${formatNumber(stats.highestScore)}</div></div>
    <div class="stat-card"><div class="stat-label">Average Score</div><div class="stat-value">${formatNumber(stats.averageScore)}</div></div>
    <div class="stat-card"><div class="stat-label">Lowest Score</div><div class="stat-value">${formatNumber(stats.lowestScore)}</div></div>
  `;
}

const STATUS_BADGE = {
  completed: '<span class="badge badge-success">Completed</span>',
  in_progress: '<span class="badge badge-warning">In Progress</span>',
  expired: '<span class="badge badge-neutral">Expired</span>',
};

function rowHtml(a) {
  return `
    <tr>
      <td>${escapeHtml(a.student_name)}</td>
      <td class="mono">${escapeHtml(a.register_number)}</td>
      <td class="mono">${escapeHtml(a.mobile_number)}</td>
      <td>${STATUS_BADGE[a.status] || a.status}</td>
      <td>${formatDateTime(a.start_time)}</td>
      <td>${a.submitted_at ? formatDateTime(a.submitted_at) : '—'}</td>
      <td class="mono">${a.time_taken_seconds !== null ? formatDuration(a.time_taken_seconds) : '—'}</td>
      <td class="mono">${a.score !== null ? `${formatNumber(a.score)} / ${formatNumber(a.total_marks)}` : '—'}</td>
      <td class="mono">${a.percentage !== null ? `${formatNumber(a.percentage)}%` : '—'}</td>
    </tr>
  `;
}

async function loadTestInfo() {
  const test = await api.adminGet(`/tests/${testId}`);
  document.getElementById('testTitleHeading').textContent = `Results — ${test.title}`;
  document.getElementById('testSubtitle').textContent = `${test.question_count} questions · ${test.marks_per_question} mark(s) each`;
  document.getElementById('questionsLink').href = `/admin/questions.html?testId=${testId}`;
}

async function loadResults() {
  tableContainer.innerHTML = `<div class="page-loader"><span class="spinner"></span> Loading results…</div>`;
  const query = new URLSearchParams();
  if (searchInput.value.trim()) query.set('search', searchInput.value.trim());
  if (statusFilter.value) query.set('status', statusFilter.value);

  try {
    const [stats, attempts] = await Promise.all([
      api.adminGet(`/tests/${testId}/stats`),
      api.adminGet(`/tests/${testId}/results?${query.toString()}`),
    ]);
    renderStats(stats);

    if (attempts.length === 0) {
      tableContainer.innerHTML = `<div class="card empty-state"><p>No students match these filters yet.</p></div>`;
      return;
    }

    tableContainer.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th><th>College Name</th><th>Designation</th><th>Status</th>
              <th>Start Time</th><th>Submitted At</th><th>Time Taken</th><th>Score</th><th>Percentage</th>
            </tr>
          </thead>
          <tbody>${attempts.map(rowHtml).join('')}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    tableContainer.innerHTML = `<div class="card empty-state"><p class="text-danger">${err.message}</p></div>`;
    toast.error(err.message);
  }
}

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadResults, 350);
});
statusFilter.addEventListener('change', loadResults);

document.getElementById('exportCsvBtn').addEventListener('click', async () => {
  try {
    await downloadAuthenticated(`/tests/${testId}/export/csv`, 'results.csv');
  } catch (err) {
    toast.error(err.message);
  }
});
document.getElementById('exportXlsxBtn').addEventListener('click', async () => {
  try {
    await downloadAuthenticated(`/tests/${testId}/export/xlsx`, 'results.xlsx');
  } catch (err) {
    toast.error(err.message);
  }
});

(async function init() {
  try {
    await loadTestInfo();
    await loadResults();
  } catch (err) {
    toast.error(err.message);
  }
})();
