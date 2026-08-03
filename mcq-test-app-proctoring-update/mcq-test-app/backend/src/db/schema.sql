-- ============================================================================
-- MCQ Test Application — Database Schema (SQLite)
-- ============================================================================
-- Design notes:
--  - All timestamps are stored as ISO-8601 UTC strings (e.g. 2026-07-22T08:30:00.000Z)
--    so comparisons are simple lexical string comparisons and are DST/timezone safe.
--  - `tests.id` and `attempts.id` are short random slugs (see utils/idGenerator.js),
--    not auto-increment integers, because test.id is embedded in the public,
--    shareable test link (/test/:id) and should not reveal how many tests exist
--    or be easily guessable/incrementable.
--  - Foreign keys use ON DELETE CASCADE so deleting a test cleans up its
--    questions, attempts, and answers automatically.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- Admins
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- Tests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tests (
  id                  TEXT PRIMARY KEY,               -- short slug, used in /test/:id
  title               TEXT NOT NULL,
  description         TEXT DEFAULT '',
  total_questions     INTEGER NOT NULL DEFAULT 0,      -- admin's intended/target question count
  marks_per_question  REAL NOT NULL DEFAULT 1,
  duration_minutes    INTEGER NOT NULL DEFAULT 20,
  start_time          TEXT NOT NULL,                   -- ISO UTC
  end_time            TEXT NOT NULL,                   -- ISO UTC
  is_active           INTEGER NOT NULL DEFAULT 1,       -- admin can manually disable a test
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Proctoring (all opt-in, default OFF — see backend/src/db/migrate.js for the
  -- upgrade path that adds these same columns to a pre-existing database).
  proctoring_enabled        INTEGER NOT NULL DEFAULT 0,
  webcam_required            INTEGER NOT NULL DEFAULT 0,
  fullscreen_required        INTEGER NOT NULL DEFAULT 0,
  tab_switch_enforced        INTEGER NOT NULL DEFAULT 0,
  max_webcam_violations      INTEGER NOT NULL DEFAULT 2,
  max_fullscreen_violations  INTEGER NOT NULL DEFAULT 2,
  max_tab_switch_violations  INTEGER NOT NULL DEFAULT 3,

  -- Phase 2 (Feature 15): percentage of total marks needed to "pass" — used by the
  -- analytics (Passed / Failed counts) on the results page. Default 40%.
  pass_percentage           REAL NOT NULL DEFAULT 40
);

-- ----------------------------------------------------------------------------
-- Questions
-- ----------------------------------------------------------------------------
-- `correct_option` is kept for backwards compatibility (every pre-Phase-2
-- question has exactly one); `correct_options` is the single source of truth
-- for scoring and holds a sorted, comma-joined list, e.g. 'A,C' (Phase 2,
-- Feature 7 — multiple correct answers).
CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id        TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Phase 2 (Features 7/8/16): Google-Forms-style question settings.
  correct_options   TEXT,               -- sorted comma-joined list, e.g. 'A,C'
  answer_count      INTEGER NOT NULL DEFAULT 1,  -- how many options students must select
  points            REAL,               -- per-question marks (NULL -> use test.marks_per_question)
  description       TEXT DEFAULT '',    -- optional sub-text under the question
  image_url         TEXT,               -- optional image shown with the question
  video_url         TEXT,               -- optional embedded video URL
  is_required       INTEGER NOT NULL DEFAULT 0,  -- block navigation when unanswered
  validation_type   TEXT,               -- 'exact' | 'at_least' | 'at_most' | NULL
  validation_value  INTEGER,            -- N for the validation rule
  validation_message TEXT,              -- custom error message shown to the student
  shuffle_options   INTEGER NOT NULL DEFAULT 1  -- per-question option shuffle toggle
);

CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id);

-- ----------------------------------------------------------------------------
-- Attempts (one row per student per test)
-- ----------------------------------------------------------------------------
-- Timer robustness strategy:
--   `end_at` is computed ONCE when the attempt is created:
--       end_at = min(now + test.duration_minutes, test.end_time)
--   The authoritative "remaining time" is always (end_at - now), recomputed on
--   every request. This is immune to refreshes, dropped connections, and
--   clock drift from periodically decrementing a stored counter.
--   `remaining_time_seconds` is ALSO persisted (snapshotted on every autosave)
--   to satisfy "store remaining time in the database" directly and to make
--   the value inspectable/auditable in the DB without recomputation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  id                     TEXT PRIMARY KEY,             -- short slug
  test_id                TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_name           TEXT NOT NULL,
  register_number        TEXT NOT NULL COLLATE NOCASE,
  mobile_number          TEXT NOT NULL,
  start_time             TEXT NOT NULL,                 -- ISO UTC, when attempt began
  end_at                 TEXT NOT NULL,                 -- ISO UTC, deadline for this attempt
  submitted_at           TEXT,                          -- ISO UTC, when actually submitted
  time_taken_seconds     INTEGER,
  remaining_time_seconds INTEGER,
  score                  REAL,
  total_marks            REAL,
  percentage             REAL,
  status                 TEXT NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress', 'completed', 'expired')),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Proctoring: violation counters + why the attempt ended. `submission_reason`
  -- is deliberately separate from `status` so existing status-based logic
  -- throughout the app is untouched — the admin UI derives its display label
  -- ("Completed" / "Auto Submitted" / "Cheating Detected") from this field.
  tab_switch_count        INTEGER NOT NULL DEFAULT 0,
  webcam_violation_count  INTEGER NOT NULL DEFAULT 0,
  fullscreen_violation_count INTEGER NOT NULL DEFAULT 0,
  submission_reason       TEXT, -- 'manual' | 'timeout' | '*_violation'
  session_token           TEXT, -- Phase 2 (Feature 14): single-active-session token

  -- A student (by register number) may only have ONE attempt per test.
  UNIQUE (test_id, register_number)
);

CREATE INDEX IF NOT EXISTS idx_attempts_test_id ON attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

-- ----------------------------------------------------------------------------
-- Answers (one row per question per attempt; upserted on every autosave)
-- ----------------------------------------------------------------------------
-- `selected_option` (single letter, CHECK-constrained) is kept for backwards
-- compatibility; `selected_options` (Phase 2) is the authoritative multi-answer
-- value: a sorted comma-joined list like 'A,C' (empty/NULL = unanswered).
CREATE TABLE IF NOT EXISTS answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id      TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option TEXT CHECK (selected_option IN ('A', 'B', 'C', 'D')),
  selected_options TEXT,               -- NEW: full sorted selection, e.g. 'A,C'
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers(attempt_id);

-- ----------------------------------------------------------------------------
-- Violations — full audit log of every proctoring event (tab switches,
-- webcam drops, fullscreen exits, blocked devtools/copy attempts).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS violations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id     TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL CHECK (violation_type IN (
                    'tab_switch', 'webcam_off', 'webcam_permission_denied',
                    'fullscreen_exit', 'devtools_attempt', 'copy_attempt', 'multi_tab'
                  )),
  details        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_violations_attempt_id ON violations(attempt_id);
