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
const analyticsCard = document.getElementById('analyticsCard');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// NEW (Phase 2, Feature 15): pass/fail split, question analytics extremes,
// and the question-wise accuracy table are rendered below the stat cards.
function renderStats(stats) {
  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Attended</div><div class="stat-value">${stats.totalAttended}</div></div>
    <div class="stat-card"><div class="stat-label">Passed</div><div class="stat-value success">${stats.passedCount ?? '—'}</div></div>
    <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value danger">${stats.failedCount ?? '—'}</div></div>
    <div class="stat-card"><div class="stat-label">Pass %</div><div class="stat-value accent">${stats.passPercentage ?? '—'}%</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value success">${stats.completedCount}</div></div>
    <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value accent">${stats.inProgressCount}</div></div>
    <div class="stat-card"><div class="stat-label">Highest Score</div><div class="stat-value">${formatNumber(stats.highestScore)}</div></div>
    <div class="stat-card"><div class="stat-label">Average Score</div><div class="stat-value">${formatNumber(stats.averageScore)}</div></div>
    <div class="stat-card"><div class="stat-label">Lowest Score</div><div class="stat-value">${formatNumber(stats.lowestScore)}</div></div>
  `;

  const extremes = [];
  if (stats.mostWrongQuestion) {
    extremes.push(`
      <div class="analytics-extreme">
        <span class="badge badge-danger">Most Wrong</span>
        <div class="analytics-extreme-text">${escapeHtml(stats.mostWrongQuestion.question_text)}</div>
        <div class="text-sm text-muted">${stats.mostWrongQuestion.wrongCount} wrong · ${stats.mostWrongQuestion.correctCount} correct · ${stats.mostWrongQuestion.accuracyPct === null ? '—' : `${stats.mostWrongQuestion.accuracyPct}% accuracy`}</div>
      </div>`);
  }
  if (stats.mostCorrectQuestion) {
    extremes.push(`
      <div class="analytics-extreme">
        <span class="badge badge-success">Most Correct</span>
        <div class="analytics-extreme-text">${escapeHtml(stats.mostCorrectQuestion.question_text)}</div>
        <div class="text-sm text-muted">${stats.mostCorrectQuestion.correctCount} correct · ${stats.mostCorrectQuestion.wrongCount} wrong · ${stats.mostCorrectQuestion.accuracyPct === null ? '—' : `${stats.mostCorrectQuestion.accuracyPct}% accuracy`}</div>
      </div>`);
  }

  if ((stats.questionWiseAccuracy || []).length > 0) {
    analyticsCard.classList.remove('hidden');
    document.getElementById('analyticsExtremes').innerHTML = extremes.join('') || '<p class="text-muted text-sm">No completed attempts with answered questions yet.</p>';
    document.getElementById('analyticsBody').innerHTML = stats.questionWiseAccuracy.map((q, i) => `
      <tr>
        <td class="mono">${i + 1}</td>
        <td>${escapeHtml(q.question_text)}</td>
        <td class="mono">${q.correctCount}</td>
        <td class="mono">${q.wrongCount}</td>
        <td class="mono">${q.accuracyPct === null ? '—' : `${q.accuracyPct}%`}</td>
      </tr>
    `).join('');
  }
}

// NEW: proctoring — keyed on the richer `display_status` (falls back to the
// original `status` for any row an older API version might still send).
const STATUS_BADGE = {
  completed: '<span class="badge badge-success">Completed</span>',
  in_progress: '<span class="badge badge-warning">In Progress</span>',
  expired: '<span class="badge badge-neutral">Expired</span>',
  auto_submitted: '<span class="badge badge-info">Auto Submitted</span>',
  cheating_detected: '<span class="badge badge-danger">Cheating Detected</span>',
};

function rowHtml(a, passPercentage) {
  // NEW (Phase 2, Feature 15): pass/fail is derived from the test's configured
  // pass threshold, matching the CSV/Excel/PDF exports.
  let passBadge = '—';
  if (a.percentage !== null && a.percentage !== undefined) {
    const passed = a.percentage >= passPercentage;
    passBadge = passed
      ? '<span class="badge badge-success">Pass</span>'
      : '<span class="badge badge-danger">Fail</span>';
  }
  // NEW (Phase 2, Feature 5): detailed per-attempt review for finished attempts.
  const reviewBtn = a.status === 'in_progress'
    ? '<span class="text-muted text-sm">—</span>'
    : `<a class="btn btn-secondary btn-sm" href="/admin/review.html?testId=${testId}&attemptId=${a.id}">Review</a>`;

  return `
    <tr>
      <td>${escapeHtml(a.student_name)}</td>
      <td class="mono">${escapeHtml(a.register_number)}</td>
      <td class="mono">${escapeHtml(a.mobile_number)}</td>
      <td>${STATUS_BADGE[a.display_status] || STATUS_BADGE[a.status] || a.status}</td>
      <td>${passBadge}</td>
      <td>${formatDateTime(a.start_time)}</td>
      <td>${a.submitted_at ? formatDateTime(a.submitted_at) : '—'}</td>
      <td class="mono">${a.time_taken_seconds !== null ? formatDuration(a.time_taken_seconds) : '—'}</td>
      <td class="mono">${a.score !== null ? `${formatNumber(a.score)} / ${formatNumber(a.total_marks)}` : '—'}</td>
      <td class="mono">${a.percentage !== null ? `${formatNumber(a.percentage)}%` : '—'}</td>
      <td class="mono text-center">${a.tab_switch_count ?? 0}</td>
      <td class="mono text-center">${a.webcam_violation_count ?? 0}</td>
      <td class="mono text-center">${a.fullscreen_violation_count ?? 0}</td>
      <td>${reviewBtn}</td>
    </tr>
  `;
}

async function loadTestInfo() {
  const test = await api.adminGet(`/tests/${testId}`);
  document.getElementById('testTitleHeading').textContent = `Results — ${test.title}`;
  document.getElementById('testSubtitle').textContent = `${test.question_count} questions · ${test.marks_per_question} mark(s) each · ${test.pass_percentage ?? 40}% to pass`;
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
    const passPercentage = stats.passPercentage ?? 40;

    if (attempts.length === 0) {
      tableContainer.innerHTML = `<div class="card empty-state"><p>No students match these filters yet.</p></div>`;
      return;
    }

    tableContainer.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th><th>College Name</th><th>Designation</th><th>Status</th><th>Result</th>
              <th>Start Time</th><th>Submitted At</th><th>Time Taken</th><th>Score</th><th>Percentage</th>
              <th>Tab Switches</th><th>Webcam Violations</th><th>Fullscreen Exits</th><th></th>
            </tr>
          </thead>
          <tbody>${attempts.map((a) => rowHtml(a, passPercentage)).join('')}</tbody>
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
// NEW (Phase 2, Feature 15): PDF export.
document.getElementById('exportPdfBtn').addEventListener('click', async () => {
  try {
    await downloadAuthenticated(`/tests/${testId}/export/pdf`, 'results.pdf');
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
