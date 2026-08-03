// ============================================================================
// Attempt model — query functions for the `attempts` table
// ============================================================================
const { db } = require('../db');

const Attempt = {
  create(attempt) {
    const stmt = db.prepare(`
      INSERT INTO attempts (id, test_id, student_name, register_number, mobile_number,
                             start_time, end_at, remaining_time_seconds, status, session_token)
      VALUES (@id, @test_id, @student_name, @register_number, @mobile_number,
              @start_time, @end_at, @remaining_time_seconds, 'in_progress', @session_token)
    `);
    stmt.run(attempt);
    return Attempt.findById(attempt.id);
  },

  findById(id) {
    return db.prepare('SELECT * FROM attempts WHERE id = ?').get(id);
  },

  /** Look up an existing attempt for this student on this test (enforces one-attempt rule). */
  findByTestAndRegister(testId, registerNumber) {
    return db.prepare(
      'SELECT * FROM attempts WHERE test_id = ? AND register_number = ? COLLATE NOCASE'
    ).get(testId, registerNumber);
  },

  findByTestId(testId) {
    return db.prepare('SELECT * FROM attempts WHERE test_id = ? ORDER BY created_at DESC').all(testId);
  },

  /** Persist the latest computed remaining-time snapshot (called on autosave/status checks). */
  updateRemainingTime(id, remainingTimeSeconds) {
    return db.prepare('UPDATE attempts SET remaining_time_seconds = ? WHERE id = ?')
      .run(Math.max(0, Math.round(remainingTimeSeconds)), id);
  },

  // -- NEW: single-active-session token (Phase 2, Feature 14) ---------------
  /**
   * Replaces the attempt's session token with a fresh one. The previous token
   * becomes invalid immediately — any other tab still holding it will get a
   * 409 `session_revoked` on its next request. Returns the new token.
   */
  issueSessionToken(id) {
    const token = require('crypto').randomBytes(32).toString('hex');
    db.prepare('UPDATE attempts SET session_token = ? WHERE id = ?').run(token, id);
    return token;
  },

  /**
   * Finalize an attempt with its computed score — used by both manual submit and auto-submit.
   * `submissionReason` records WHY the attempt ended:
   * 'manual' | 'timeout' | 'tab_switch_violation' | 'webcam_violation' | 'fullscreen_violation' | 'multi_tab'
   * It defaults to 'manual' so every pre-existing call site (which doesn't know about
   * this parameter) keeps behaving exactly as before.
   */
  complete(id, {
    submittedAt, timeTakenSeconds, score, totalMarks, percentage, status = 'completed',
    submissionReason = 'manual',
  }) {
    db.prepare(`
      UPDATE attempts
      SET status = @status, submitted_at = @submittedAt, time_taken_seconds = @timeTakenSeconds,
          score = @score, total_marks = @totalMarks, percentage = @percentage,
          remaining_time_seconds = 0, submission_reason = @submissionReason, session_token = NULL
      WHERE id = @id
    `).run({
      id, status, submittedAt, timeTakenSeconds, score, totalMarks, percentage, submissionReason,
    });
    return Attempt.findById(id);
  },

  // -- NEW: Proctoring ---------------------------------------------------
  /**
   * Atomically increments the counter for one violation type and returns the
   * updated attempt. `column` must be one of the three known counter columns
   * — never built from unsanitized input (see publicController.reportViolation).
   */
  incrementViolationCount(id, column) {
    const allowed = ['tab_switch_count', 'webcam_violation_count', 'fullscreen_violation_count'];
    if (!allowed.includes(column)) throw new Error(`Invalid violation counter column: ${column}`);
    db.prepare(`UPDATE attempts SET ${column} = ${column} + 1 WHERE id = ?`).run(id);
    return Attempt.findById(id);
  },

  stats(testId, passPercentage = 40) {
    const rows = db.prepare(
      "SELECT score, percentage, status FROM attempts WHERE test_id = ?"
    ).all(testId);

    const completed = rows.filter((r) => r.status === 'completed');
    const inProgress = rows.filter((r) => r.status === 'in_progress');
    const scores = completed.map((r) => r.score).filter((s) => s !== null && s !== undefined);
    const percents = completed.map((r) => r.percentage).filter((p) => p !== null && p !== undefined);

    return {
      totalAttended: rows.length,
      completedCount: completed.length,
      inProgressCount: inProgress.length,
      // NEW (Phase 2, Feature 15): pass/fail split using the test's configured
      // pass threshold (percentage of total marks, default 40%).
      passedCount: percents.filter((p) => p >= passPercentage).length,
      failedCount: percents.filter((p) => p < passPercentage).length,
      passPercentage,
      highestScore: scores.length ? Math.max(...scores) : null,
      lowestScore: scores.length ? Math.min(...scores) : null,
      averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  },
};

module.exports = Attempt;
