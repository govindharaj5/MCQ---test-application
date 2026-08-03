// ============================================================================
// Attempt model — query functions for the `attempts` table
// ============================================================================
const { db } = require('../db');

const Attempt = {
  create(attempt) {
    const stmt = db.prepare(`
      INSERT INTO attempts (id, test_id, student_name, register_number, mobile_number,
                             start_time, end_at, remaining_time_seconds, status)
      VALUES (@id, @test_id, @student_name, @register_number, @mobile_number,
              @start_time, @end_at, @remaining_time_seconds, 'in_progress')
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

  /** Finalize an attempt with its computed score — used by both manual submit and auto-submit. */
  complete(id, { submittedAt, timeTakenSeconds, score, totalMarks, percentage, status = 'completed' }) {
    db.prepare(`
      UPDATE attempts
      SET status = @status, submitted_at = @submittedAt, time_taken_seconds = @timeTakenSeconds,
          score = @score, total_marks = @totalMarks, percentage = @percentage,
          remaining_time_seconds = 0
      WHERE id = @id
    `).run({ id, status, submittedAt, timeTakenSeconds, score, totalMarks, percentage });
    return Attempt.findById(id);
  },

  stats(testId) {
    const rows = db.prepare(
      "SELECT score, percentage, status FROM attempts WHERE test_id = ?"
    ).all(testId);

    const completed = rows.filter((r) => r.status === 'completed');
    const inProgress = rows.filter((r) => r.status === 'in_progress');
    const scores = completed.map((r) => r.score).filter((s) => s !== null && s !== undefined);

    return {
      totalAttended: rows.length,
      completedCount: completed.length,
      inProgressCount: inProgress.length,
      highestScore: scores.length ? Math.max(...scores) : null,
      lowestScore: scores.length ? Math.min(...scores) : null,
      averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  },
};

module.exports = Attempt;
