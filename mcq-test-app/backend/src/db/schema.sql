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
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- Questions
-- ----------------------------------------------------------------------------
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
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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

  -- A student (by register number) may only have ONE attempt per test.
  UNIQUE (test_id, register_number)
);

CREATE INDEX IF NOT EXISTS idx_attempts_test_id ON attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

-- ----------------------------------------------------------------------------
-- Answers (one row per question per attempt; upserted on every autosave)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id      TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option TEXT CHECK (selected_option IN ('A', 'B', 'C', 'D')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers(attempt_id);
