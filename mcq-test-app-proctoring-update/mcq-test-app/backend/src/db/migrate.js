// ============================================================================
// migrate.js — safe, additive, idempotent schema migrations
// ============================================================================
// WHY THIS FILE EXISTS:
//   schema.sql uses `CREATE TABLE IF NOT EXISTS`, which only helps on a
//   completely fresh database. It does NOT add new columns to a table that
//   already exists from a previous deployment (e.g. your live Render
//   database, which already has real student results in it). This file
//   handles that upgrade path safely.
//
// SAFETY GUARANTEES:
//   - Every change here is additive: new tables, or new nullable/defaulted
//     columns on existing tables. Nothing is dropped, renamed, or rewritten.
//   - Every operation is guarded by an existence check (via PRAGMA
//     table_info), so this function is 100% safe to run on every single
//     server start, on any database — brand new, mid-upgrade, or already
//     fully migrated. Running it twice (or a hundred times) is a no-op.
//   - New columns on `tests` all default to 0 (disabled), so every test you
//     already created keeps behaving EXACTLY as it did before — none of the
//     new proctoring features turn on by themselves. Admins opt in per test
//     going forward via the "Proctoring & Security" section on the test form.
// ============================================================================

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, columnName, columnDefSql) {
  if (!columnExists(db, table, columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnDefSql}`);
    // eslint-disable-next-line no-console
    console.log(`  [migrate] added column ${table}.${columnName}`);
  }
}

function tableExists(db, table) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
  ).get(table);
  return !!row;
}

const VIOLATION_TYPES = [
  'tab_switch', 'webcam_off', 'webcam_permission_denied',
  'fullscreen_exit', 'devtools_attempt', 'copy_attempt', 'multi_tab',
];

function runMigrations(db) {
  // ---- tests: opt-in proctoring configuration (all default OFF) ----
  addColumnIfMissing(db, 'tests', 'proctoring_enabled', "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, 'tests', 'webcam_required', "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, 'tests', 'fullscreen_required', "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, 'tests', 'tab_switch_enforced', "INTEGER NOT NULL DEFAULT 0");
  // Thresholds match the spec defaults exactly (webcam=2, fullscreen=2, tab-switch=3)
  // but are stored per-test so an admin can tune them later without a code change.
  addColumnIfMissing(db, 'tests', 'max_webcam_violations', 'INTEGER NOT NULL DEFAULT 2');
  addColumnIfMissing(db, 'tests', 'max_fullscreen_violations', 'INTEGER NOT NULL DEFAULT 2');
  addColumnIfMissing(db, 'tests', 'max_tab_switch_violations', 'INTEGER NOT NULL DEFAULT 3');
  // NEW (Phase 2, Feature 15): passing threshold as a percentage of total marks.
  // 40% matches the student result page's existing score-coloring boundary, and is
  // per-test configurable (see the Analytics section on the results page).
  addColumnIfMissing(db, 'tests', 'pass_percentage', 'REAL NOT NULL DEFAULT 40');

  // ---- attempts: violation counters + why an attempt ended ----
  addColumnIfMissing(db, 'attempts', 'tab_switch_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'attempts', 'webcam_violation_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'attempts', 'fullscreen_violation_count', 'INTEGER NOT NULL DEFAULT 0');
  // 'manual' | 'timeout' | 'tab_switch_violation' | 'webcam_violation' | 'fullscreen_violation'
  // Deliberately a separate column from the existing `status` (in_progress/completed/expired)
  // rather than overloading it, so none of the existing status-based logic anywhere in the
  // app has to change. The admin UI derives its "Completed / Auto Submitted / Cheating
  // Detected" display label from this new field — see frontend/js/admin/results.js.
  addColumnIfMissing(db, 'attempts', 'submission_reason', 'TEXT');
  // NEW (Phase 2, Feature 14): single-use session token. Issued when an attempt starts
  // (or resumes after a refresh) and revoked the moment a NEW session is created for the
  // same attempt — which is how "opening the exam in a second tab" is detected and
  // blocked server-side. See backend/src/middleware/attemptAuth.js.
  addColumnIfMissing(db, 'attempts', 'session_token', 'TEXT');

  // ---- questions (Phase 2, Features 7/8/16): multi-answer + Google-Forms-style settings ----
  addColumnIfMissing(db, 'questions', 'correct_options', 'TEXT');
  addColumnIfMissing(db, 'questions', 'answer_count', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'questions', 'points', 'REAL');
  addColumnIfMissing(db, 'questions', 'description', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'questions', 'image_url', 'TEXT');
  addColumnIfMissing(db, 'questions', 'video_url', 'TEXT');
  addColumnIfMissing(db, 'questions', 'is_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'questions', 'validation_type', "TEXT"); // 'exact' | 'at_least' | 'at_most' | NULL
  addColumnIfMissing(db, 'questions', 'validation_value', 'INTEGER');
  addColumnIfMissing(db, 'questions', 'validation_message', 'TEXT');
  addColumnIfMissing(db, 'questions', 'shuffle_options', 'INTEGER NOT NULL DEFAULT 1');

  // Backfill: every existing question had exactly one correct option; express it in
  // the new multi-answer column too so scoring has a single source of truth.
  db.prepare(`
    UPDATE questions SET correct_options = correct_option
    WHERE correct_options IS NULL OR correct_options = ''
  `).run();

  // ---- answers (Phase 2, Features 6/7): store a LIST of selected options ----
  // The old single-letter column (with its CHECK constraint) is kept untouched for
  // backwards compatibility; the new TEXT column stores the full sorted selection,
  // e.g. "A,C". Scoring reads `selected_options` and falls back to `selected_option`.
  addColumnIfMissing(db, 'answers', 'selected_options', 'TEXT');
  db.prepare(`
    UPDATE answers SET selected_options = selected_option
    WHERE selected_options IS NULL OR selected_options = ''
  `).run();

  // ---- violations: full audit log (Feature: "Log every webcam violation") ----
  // Phase 2 adds the 'multi_tab' type. SQLite cannot modify a CHECK constraint in
  // place, so if the table already exists WITHOUT the new type we rebuild it (a
  // safe, data-preserving table swap inside a transaction — the table has no
  // inbound foreign keys and is recreated with identical columns).
  if (!tableExists(db, 'violations')) {
    createViolationsTable(db);
  } else {
    const ddl = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='violations'`,
    ).get();
    if (!ddl || !ddl.sql || !ddl.sql.includes('multi_tab')) {
      db.exec('BEGIN');
      try {
        db.exec('DROP TABLE IF EXISTS violations_legacy');
        db.exec(`
          ALTER TABLE violations RENAME TO violations_legacy;
          CREATE TABLE violations (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id     TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
            violation_type TEXT NOT NULL CHECK (violation_type IN (
                              'tab_switch', 'webcam_off', 'webcam_permission_denied',
                              'fullscreen_exit', 'devtools_attempt', 'copy_attempt', 'multi_tab'
                            )),
            details        TEXT,
            created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          );
          INSERT INTO violations (id, attempt_id, violation_type, details, created_at)
            SELECT id, attempt_id, violation_type, details, created_at FROM violations_legacy;
          DROP TABLE violations_legacy;
        `);
        db.exec(`CREATE INDEX idx_violations_attempt_id ON violations(attempt_id)`);
        db.exec('COMMIT');
        // eslint-disable-next-line no-console
        console.log('  [migrate] rebuilt table violations (added multi_tab type)');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }
}

function createViolationsTable(db) {
  db.exec(`
    CREATE TABLE violations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id     TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      violation_type TEXT NOT NULL CHECK (violation_type IN (
                        'tab_switch', 'webcam_off', 'webcam_permission_denied',
                        'fullscreen_exit', 'devtools_attempt', 'copy_attempt', 'multi_tab'
                      )),
      details        TEXT,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  db.exec(`CREATE INDEX idx_violations_attempt_id ON violations(attempt_id)`);
  // eslint-disable-next-line no-console
  console.log('  [migrate] created table violations');
}

module.exports = { runMigrations, columnExists, addColumnIfMissing };
