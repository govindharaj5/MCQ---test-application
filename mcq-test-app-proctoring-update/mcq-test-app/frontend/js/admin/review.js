// ============================================================================
// review.js (NEW, Phase 2 — Feature 5)
// ----------------------------------------------------------------------------
// Admin "Detailed Review" page: shows ONE attempt question by question, using
// the SAME shuffled option order the student actually saw (the server
// recomputes the deterministic per-attempt shuffle), the correct answers,
// the student's selection, and marks awarded.
// ============================================================================
import { api } from '../api.js';
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
const attemptId = params.get('attemptId');
if (!testId || !attemptId) location.href = '/admin/dashboard.html';

const loadingState = document.getElementById('loadingState');
const reviewContent = document.getElementById('reviewContent');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const STATUS_BADGE = {
  completed: '<span class="badge badge-success">Completed</span>',
  in_progress: '<span class="badge badge-warning">In Progress</span>',
  expired: '<span class="badge badge-neutral">Expired</span>',
  auto_submitted: '<span class="badge badge-info">Auto Submitted</span>',
  cheating_detected: '<span class="badge badge-danger">Cheating Detected</span>',
};

function questionItemHtml(q, index) {
  const correctLabels = q.correct || [];
  const selectedLabels = q.selected || [];
  const stateClass = q.isCorrect ? 'opt-correct' : (selectedLabels.length === 0 ? 'opt-unanswered' : 'opt-wrong');

  // Mark each option: correct, student-selected, or both.
  const optionsHtml = q.options.map((opt) => {
    const isCorrect = correctLabels.includes(opt.label);
    const isSelected = selectedLabels.includes(opt.label);
    let cls = 'review-opt';
    if (isCorrect && isSelected) cls += ' correct selected';
    else if (isCorrect) cls += ' correct';
    else if (isSelected) cls += ' selected';
    return `
      <div class="${cls}">
        <span class="option-letter">${opt.label}</span>
        <span class="option-text">${escapeHtml(opt.text)}</span>
        ${isCorrect && isSelected ? '<span class="review-tag tag-both">Correct · chosen</span>'
          : isCorrect ? '<span class="review-tag tag-correct">Correct answer</span>'
          : isSelected ? '<span class="review-tag tag-wrong">Student chose</span>' : ''}
      </div>
    `;
  }).join('');

  const media = (q.image_url ? `<img src="${escapeHtml(q.image_url)}" alt="Question image" class="review-media" />` : '')
    + (q.video_url ? `<video src="${escapeHtml(q.video_url)}" controls playsinline preload="metadata" class="review-media"></video>` : '');

  return `
    <div class="review-question ${stateClass}">
      <div class="review-q-head">
        <div>
          <span class="review-q-num">Q${index + 1}</span>
          <span class="review-q-points mono">${formatNumber(q.points)} pt${q.points === 1 ? '' : 's'} · ${q.isCorrect ? 'Correct' : (selectedLabels.length === 0 ? 'Unanswered' : 'Wrong')}</span>
        </div>
        <span class="mono ${q.isCorrect ? 'text-success' : 'text-danger'}">${q.marks} / ${formatNumber(q.points)}</span>
      </div>
      <div class="review-q-text">${escapeHtml(q.question_text)}</div>
      ${q.description ? `<div class="review-q-desc">${escapeHtml(q.description)}</div>` : ''}
      ${media}
      <div class="review-options">${optionsHtml}</div>
      ${selectedLabels.length === 0 ? '<div class="review-no-answer text-muted text-sm">No answer selected.</div>' : ''}
    </div>
  `;
}

async function init() {
  try {
    const data = await api.adminGet(`/tests/${testId}/attempts/${attemptId}/review`);
    const { attempt, questions, summary } = data;

    document.getElementById('resultsBreadcrumb').href = `/admin/results.html?testId=${testId}`;

    const passPercentage = data.passPercentage ?? 40;
    let resultBadge = '—';
    if (summary.percentage !== null && summary.percentage !== undefined) {
      resultBadge = summary.percentage >= passPercentage
        ? '<span class="badge badge-success">Pass</span>'
        : '<span class="badge badge-danger">Fail</span>';
    }

    reviewContent.innerHTML = `
      <div class="review-attempt-head">
        <div>
          <h3 style="margin:0;">${escapeHtml(attempt.student_name)} <span class="text-muted mono" style="font-weight:400;">· ${escapeHtml(attempt.register_number)}</span></h3>
          <p class="text-muted text-sm" style="margin: var(--space-2) 0 0;">
            ${STATUS_BADGE[attempt.display_status] || attempt.status}
            &nbsp;${resultBadge}
            &nbsp;· Started ${formatDateTime(attempt.start_time)}
            ${attempt.submitted_at ? `· Submitted ${formatDateTime(attempt.submitted_at)}` : ''}
            ${attempt.time_taken_seconds !== null ? `· Took ${formatDuration(attempt.time_taken_seconds)}` : ''}
          </p>
        </div>
        <div class="review-score">
          <div class="mono" style="font-size: 1.4rem;">${formatNumber(summary.score)} / ${formatNumber(summary.totalMarks)}</div>
          <div class="text-muted text-sm">${summary.percentage !== null ? `${formatNumber(summary.percentage)}%` : '—'}</div>
        </div>
      </div>

      <div class="review-summary">
        <div class="stat-card"><div class="stat-label">Correct</div><div class="stat-value success">${summary.correctCount}</div></div>
        <div class="stat-card"><div class="stat-label">Wrong</div><div class="stat-value danger">${summary.wrongCount}</div></div>
        <div class="stat-card"><div class="stat-label">Unanswered</div><div class="stat-value accent">${summary.unansweredCount}</div></div>
        <div class="stat-card"><div class="stat-label">Proctoring</div><div class="stat-value text-sm" style="font-size:0.95rem;">Tab ${attempt.tab_switch_count ?? 0} · Cam ${attempt.webcam_violation_count ?? 0} · FS ${attempt.fullscreen_violation_count ?? 0}</div></div>
      </div>

      <div class="review-legend text-sm text-muted">
        <span><span class="legend-swatch correct"></span> Correct answer</span>
        <span><span class="legend-swatch selected"></span> Student's choice</span>
        <span><span class="legend-swatch both"></span> Correct &amp; chosen</span>
      </div>

      <div class="review-questions">
        ${questions.map(questionItemHtml).join('')}
      </div>
    `;

    loadingState.classList.add('hidden');
    reviewContent.classList.remove('hidden');
  } catch (err) {
    loadingState.innerHTML = `<div class="empty-state"><p class="text-danger">${escapeHtml(err.message)}</p></div>`;
    toast.error(err.message);
  }
}

init();
