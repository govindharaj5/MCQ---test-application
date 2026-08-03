# Update: Advanced Question Features, Analytics & Session Security (Phase 2)

This document covers the changes made in this update — the second phase of your 18-feature request. It's kept separate from `README.md` and `PROCTORING_UPDATE.md` so you can see exactly what changed in this phase, why, how to verify it, and what deployment steps are needed.

Phase 1 (exam integrity: webcam, tab-switch, fullscreen, violation logging, anti-copy warnings) is untouched — **no Phase 1 feature was removed or changed in behavior**.

---

## What was added (mapped to your feature list)

**Feature 5 — Detailed Review of Each Attempt (admin)**
- New admin page `admin/review.html` shows a single attempt question by question: the options **in the exact shuffled order the student saw**, which options are correct, what the student selected, and marks awarded
- Header summary: student, register number, status, Pass/Fail verdict, start/submitted times, duration, score
- Per-question styling: Correct answer / Student's choice / Correct & chosen / Unanswered
- Backend: `GET /api/tests/:testId/attempts/:attemptId/review` (see `backend/src/services/analyticsService.js`)

**Feature 7 — Multiple Correct Answers**
- Questions can now have 2–4 correct answers; the editor's "Correct Answer" radios became checkboxes ("tick all that apply")
- Students see checkboxes instead of radios automatically
- Scoring is an **exact set match** (all-or-nothing): `selected == correct` for full points, anything else 0 — no partial credit
- Fully backward compatible: questions with a single correct answer behave exactly as before (radio UI, same scoring)

**Feature 8 — Google Forms Style Question Editor**
- Per-question settings in the editor: Description (shown under the question), Image URL, Video URL, Points (defaults to the test's marks-per-question), Required toggle, Shuffle options toggle, Response validation (Exactly / At least / At most N answers, with optional custom error message)
- New "Preview" button shows the question exactly as a student sees it
- New "Duplicate" button clones a question
- Question list now shows badges (correct-answer count, points, validation, required)

**Feature 9 — Shuffle Options per Student**
- Each attempt sees a **deterministic, seeded shuffle** of both question order and option order
  - Different students → different orders; the SAME student on refresh → the SAME order (resume works)
- Answers are stored in canonical letters (A–D); only the display positions are shuffled, so scoring and the admin review stay correct
- Per-question "Shuffle options" toggle in the editor (default ON); toggling OFF keeps that question's canonical A–D order for everyone
- Old tests (created before this phase) get the same deterministic shuffle automatically — question *order* changes per attempt, matching your request

**Feature 10 — Required Questions + Response Validation at Take Time**
- Required questions and validation rules are enforced in the student UI:
  - Selecting too few/too many answers shows the admin's custom message inline and blocks "Next" until fixed (Google-Forms behavior)
  - Submit is blocked while any partially-answered question violates its rule (jumps the student to it)
  - Multi-answer questions without an explicit rule imply "exactly N answers"
- Unanswered (empty) questions are never "invalid" — they count as unanswered, exactly as before

**Feature 14 — Single-Active-Session Lock (multi-tab prevention)**
- Every attempt now mints a 64-char session token on start/resume; the student browser must present it on every answer/violation/submit request (`X-Attempt-Token` header)
- Opening the test link in a second tab/device displaces the first tab; the old tab immediately gets `409 { code: 'session_revoked' }` and shows a "Session Locked" screen
- The displacement is logged to the `violations` table as `multi_tab` (audit trail, no auto-submit)
- The student result page still loads for a completed attempt without a token (no lockout after finishing)

**Feature 15 — Extended Analytics + PDF Export + Pass/Fail**
- Tests now have a configurable **Pass Percentage** (default 40%; `tests.pass_percentage`), shown on the Create/Edit Test form
- Results page: Passed / Failed stat cards, per-row **Pass/Fail** badge, **Question Analytics** card (most-wrong / most-correct question, per-question accuracy table)
- CSV and Excel exports gained a `Result` (Pass/Fail) column
- New **Export PDF** button (pure-JS pdfkit — no native dependencies, serverless-safe)
- Student result page shows a PASS/FAIL verdict badge and colors the score ring by the real threshold (previously hardcoded 40%)
- Dashboard overview adds Passed / Failed / Average Score cards

**Feature 16 — Drag & Drop Question Reorder (admin)**
- Questions can be dragged into any order; a drop persists it via `POST /api/tests/:testId/questions/reorder`
- Students (and the admin review) see questions in that stored order (then per-attempt shuffled, Feature 9)

**Feature 17 — Per-Attempt Question Ordering (covered by Feature 9)** — see above; each attempt gets its own deterministic order.

**Supporting changes**
- `answers` now stores the full selected set (`selected_options`, e.g. `"A,C"`) alongside the legacy `selected_option` column; both are kept in sync so old code paths never break
- Auto-save now sends `{ selected_options: [...] }` (arrays work for single answers too); clearing a selection saves an empty set
- Back-button guard on the test page: pressing Back snaps back onto the exam and shows a warning instead of leaving
- `api.js` supports custom request headers and attaches `err.code` (e.g. `session_revoked`) to failed requests

---

## Modified files

**Backend**
- `backend/src/db/migrate.js` — additive, idempotent migration (new columns, `violations` rebuild with `multi_tab`, backfills)
- `backend/src/db/schema.sql` — fresh-install schema matching the migrated schema
- `backend/src/models/Question.js` — new fields, `normalizeRow`, `correctAnswerMap` returns `{ correct, points }`, safe defaults
- `backend/src/models/Answer.js` — multi-select upsert (`selected_options`)
- `backend/src/models/Attempt.js` — `session_token`, `issueSessionToken`, `complete` wipes the token, `stats` pass/fail
- `backend/src/models/Test.js` — `pass_percentage` in create + allowed updates
- `backend/src/utils/shuffle.js` — **new**: deterministic seeded shuffle (questions + options) and option-list helpers
- `backend/src/utils/validators.js` — `normalizeOptionSelection`, `normalizeValidationRule`, empty-selection handling
- `backend/src/utils/scoring.js` — exact-set multi-answer scoring, `normalizeSelection`
- `backend/src/utils/exporters.js` — `Result` column in CSV/XLSX, new `buildPdf` (pdfkit)
- `backend/src/middleware/attemptAuth.js` — **new**: `X-Attempt-Token` middleware (`requireAttemptToken`)
- `backend/src/middleware/errorHandler.js` — ApiError `code` (e.g. `session_revoked`)
- `backend/src/services/attemptService.js` — new scoring signature
- `backend/src/services/analyticsService.js` — **new**: question analytics + per-attempt review
- `backend/src/controllers/publicController.js` — shuffled session payload, token issuance, multi-answer save, `multi_tab` violation
- `backend/src/controllers/questionController.js` — new fields, `correct_options` as an array in list responses, reorder endpoint
- `backend/src/controllers/resultController.js` — extended stats, review endpoint, PDF export, overview pass/fail
- `backend/src/controllers/testController.js` — `pass_percentage` validation + extraction
- `backend/src/routes/publicRoutes.js` — token middleware on answer/submit/violation
- `backend/src/routes/testRoutes.js` — review + PDF export routes
- `backend/src/routes/questionRoutes.js` — reorder route
- `backend/package.json` — added `pdfkit@^0.15.0`

**Frontend**
- `frontend/js/api.js` — custom headers + `err.code`
- `frontend/js/student/entry.js` — persists the session token into sessionStorage
- `frontend/js/student/test.js` — multi-select UI, validation gating, shuffled option rendering, session-token headers, 409 `session_revoked` handling, back-button trap, per-question points/media/description
- `frontend/student/test.html` — media/description/validation areas, multi-answer badge, session-locked overlay
- `frontend/js/student/result.js` + `frontend/student/result.html` — Pass/Fail verdict badge, real pass threshold
- `frontend/admin/questions.html` + `frontend/js/admin/questions.js` — Google-Forms-style editor (description, media, points, required, validation, shuffle toggle, multi-correct, duplicate, preview, drag-drop reorder)
- `frontend/admin/results.html` + `frontend/js/admin/results.js` — Pass/Fail column, Review links, Question Analytics card, PDF export
- `frontend/admin/review.html` + `frontend/js/admin/review.js` — **new**: detailed per-attempt review page
- `frontend/admin/test-form.html` + `frontend/js/admin/test-form.js` — Pass Percentage field
- `frontend/js/admin/dashboard.js` — Passed/Failed/Average overview cards
- `frontend/css/student.css`, `frontend/css/admin.css`, `frontend/css/components.css` — Phase 2 styles (all built from existing design tokens)

**New files**
- `backend/src/utils/shuffle.js`
- `backend/src/middleware/attemptAuth.js`
- `backend/src/services/analyticsService.js`
- `frontend/admin/review.html`, `frontend/js/admin/review.js`

---

## Database migration

The migration is **additive and idempotent** — it runs automatically at server startup (`initDatabase()` → `runMigrations()`), so deploying is just "deploy the new code". For an existing Phase 1 database it:

1. Adds `tests.pass_percentage` (default 40)
2. Adds `attempts.session_token`
3. Adds 11 columns to `questions` (`correct_options`, `answer_count`, `points`, `description`, `image_url`, `video_url`, `is_required`, `validation_type`, `validation_value`, `validation_message`, `shuffle_options`)
4. Adds `answers.selected_options`
5. Backfills `correct_options` from `correct_option` and `selected_options` from `selected_option`
6. Rebuilds the `violations` table so `multi_tab` is a valid violation type (existing rows are preserved)

Verified against a copy of a real Phase 1 database: columns added, backfills correct, row counts preserved, second run is a no-op.

If you ever need a fresh start: delete `backend/data/mcqtest.db` (the server reseeds admin + creates the current schema from `schema.sql`).

---

## Deployment steps

1. **Backend (Render)** — deploy `backend/` as usual. `npm install` will now pull `pdfkit`. On first boot against your existing database, the migration runs automatically; nothing manual is needed. Keep `backend/.env` values (they control the seeded admin + JWT secret).
2. **Frontend (Vercel)** — deploy `frontend/` as usual; no build step.
3. **API base URL** — unchanged logic in `frontend/js/api.js` (localhost → `http://localhost:5000`, otherwise the deployed Render URL).

---

## Testing checklist (already run — this passed end-to-end against a fresh DB)

- Admin login, create test with `pass_percentage: 50` → persists
- Create multi-answer question (correct `A,C`, validation `exact 2`, points 2, required, shuffle on) + single-answer question + legacy-style question → all fine
- Question list returns `correct_options` as an array + `validation` object; reorder endpoint persists a new order
- Start attempt → 64-char session token; session payload has shuffled `questions[].options` (`{label, stored, text}`), `answerCount`, `points`, `validation`, `test.passPercentage`
- Reload session with the token → identical question and option order (resume works)
- Save multi-answer (array) and legacy single-answer saves; clearing an answer works
- Stale/forged token → `409 { code: 'session_revoked' }`; fresh tab claims a new token and the old tab's token is revoked
- Violation reporting still works and is token-protected
- Submit is idempotent; completed attempts load without a token
- Stats: passed/failed split, question-wise accuracy, most-correct question
- Review: summary (1 correct / 0 wrong / 2 unanswered for the test flow), display labels match the student's shuffled view, correct set shown under the shuffled labels, marks correct
- CSV (has `Result` column), XLSX, PDF exports all download with valid magic bytes
- Dashboard overview reports pass/fail across all tests
- Old-style test creation still defaults to `pass_percentage 40` and proctoring OFF
- All frontend modules pass `node --check` syntax validation

## What's intentionally unchanged / out of scope

- **No Phase 1 behavior changed**: proctoring, violation thresholds, timer, anti-copy warnings all work as before
- Existing tests/attempts keep working (migration is additive; unanswered questions score 0 as before)
- The single-active-session rule applies to **in-progress** attempts only — a completed attempt's result page never requires a token
- Question media (image/video URLs) renders on the student test page and in the admin review; no file upload server was added (URLs only, matching the request)
