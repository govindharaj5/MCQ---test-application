# Update: Exam Integrity Features (Phase 1)

This document covers the changes made in this update. It's deliberately kept separate from the main `README.md` so it's easy to see exactly what changed, why, and how to verify it — per your request for a modified-files list, migration notes, and a testing checklist.

## Why "Phase 1"

Your feature request covered 18 substantial features — webcam proctoring, tab/fullscreen enforcement, multi-correct-answer questions with Google-Forms-style validation, per-student question/option shuffling, a drag-and-drop question editor, extended analytics with PDF export, and more. Attempting all of it shallowly in one pass was a real risk to your explicit "don't break anything" requirement, so this update focuses on one complete, coherent, thoroughly-tested unit: **exam integrity** (webcam, tab-switching, fullscreen, violation logging/auto-submit, admin visibility into all of it) plus the smaller standalone items (timer improvements, anti-copy warnings). Everything else from your list is scoped for a follow-up phase — see [What's not in this update](#whats-not-in-this-update) below.

## Design principle: everything new is opt-in

Every proctoring feature is a **per-test setting that defaults OFF**. A test you created before this update — or a new test where you leave these checkboxes unchecked — behaves exactly as it did before, with zero UI or behavior change. You turn on webcam/fullscreen/tab-switch enforcement per test from the new "Proctoring & Security" section on the Create/Edit Test page. This was the only design that could honestly satisfy "do not remove any existing features" given how much these features change the student experience when active.

---

## What was added

**Feature 1 — Webcam Monitoring**
- Camera permission requested via an explicit "Enable Camera" step before the test begins (see [technical note](#why-a-pre-flight-screen) below), with a live preview shown during the test
- Webcam loss (unplugged, permission revoked, track ended) detected via both an event listener and a periodic poll, logged, and counted
- Auto-submits after the configured number of warnings (default 2)

**Feature 2 — Tab Switching Detection**
- `visibilitychange` and `blur` both monitored (debounced so one switch isn't double-counted)
- Auto-submits after the configured number of warnings (default 3, matching your spec)

**Feature 3 — Full Screen Mode**
- Entered via the same explicit pre-flight step (browsers reject `requestFullscreen()` unless it's triggered by a real click — see below)
- Exit detected via `fullscreenchange`; a warning modal lets the student click straight back into fullscreen
- Auto-submits after the configured number of warnings (default 2)

**Feature 4 — Admin Dashboard**
- The results table now shows Tab Switches, Webcam Violations, and Fullscreen Exits per student
- Status now distinguishes **Completed** / **Auto Submitted** (timer ran out) / **Cheating Detected** (a violation threshold was hit) / **In Progress**, with a matching filter option
- Every violation is logged to a new `violations` table with a timestamp (not just counted) for a full audit trail

**Feature 11 — Timer Improvements**
- One-time "5 minutes remaining" warning toast
- (The mm:ss / h:mm:ss display already auto-expanded to show hours for longer tests — no change needed there.)

**Feature 13 — Anti-Copy completion**
- Blocked actions (copy/paste/right-click/Ctrl+A/devtools shortcuts) now show a visible warning toast instead of silently doing nothing, and are logged to the audit trail
- Added Ctrl+A (select-all) to the blocked shortcut list

**Foundational work**
- A safe, additive, idempotent migration system (`backend/src/db/migrate.js`) — see [Database migration](#database-migration) below
- New `violations` audit-log table
- New violation-reporting API endpoint with server-side threshold enforcement (the browser reports *what* happened; the server decides *whether* that's enough to auto-submit — so this can't be bypassed by tampering with the frontend)

### Why a pre-flight screen?

Browsers reject `requestFullscreen()` unless it's called from a genuine, direct user gesture (a click) — calling it automatically on page load fails silently. So when a test requires webcam and/or fullscreen, `test.html` now shows a short "Before You Begin" screen with explicit "Enable Camera" / "Enter Fullscreen" buttons before the questions appear. This is also just better practice than surprising a student with an instant fullscreen jump or camera prompt.

One honest tradeoff: the countdown timer's deadline is computed when the student submits the entry form (unchanged from before), so time spent on this pre-flight screen (typically a few seconds, answering 1–2 browser permission prompts) counts against their test time, the same as if they'd spent it reading the first question. This wasn't changed to avoid touching the well-tested timer architecture for a Phase 1 update — flag it if you'd like this adjusted.

---

## What's NOT in this update

Deferred to a follow-up phase, in roughly the order they'd naturally build on each other:

| Feature | Status |
|---|---|
| 5 — Detailed per-question student review page | Not started |
| 7 — Multiple correct answers | Not started |
| 8 — Response validation (exactly/at least/at most N) | Not started |
| 9 — Shuffle options per student | Not started |
| 10 — Shuffle questions per student | Not started |
| 14 — Multi-tab lock / duplicate-session prevention | Not started |
| 15 — Pass/fail, most-wrong-question, per-question accuracy, PDF export | Not started (CSV/Excel export already includes the new violation columns) |
| 16/17 — Google-Forms-style question editor (image/video, points, duplicate, drag-drop reorder) | Not started |

Feature 6 (store every answer) and 12 (autosave/resume-on-refresh) were already fully implemented in your existing app and needed no changes.

Say the word and I'll continue with the next phase — happy to take direction on priority order if you'd rather resequence this list.

---

## Modified / new files

**Backend — new files**
- `backend/src/db/migrate.js` — migration system
- `backend/src/models/Violation.js` — violation audit-log model

**Backend — modified files**
- `backend/src/db/index.js` — runs migrations on startup
- `backend/src/db/schema.sql` — new columns/table included for fresh installs
- `backend/src/models/Test.js` — proctoring config fields
- `backend/src/models/Attempt.js` — violation counters, `submission_reason`
- `backend/src/services/attemptService.js` — records *why* an attempt was finalized
- `backend/src/controllers/publicController.js` — proctoring config in session/meta responses; new violation-report endpoint
- `backend/src/controllers/testController.js` — accepts/validates proctoring fields
- `backend/src/controllers/resultController.js` — derived status label, extended filtering
- `backend/src/utils/exporters.js` — new violation columns in CSV/XLSX
- `backend/src/routes/publicRoutes.js` — new violation route

**Frontend — new files**
- `frontend/js/student/proctoring.js` — webcam/fullscreen/tab-switch modules

**Frontend — modified files**
- `frontend/js/security.js` — visible warnings, Ctrl+A
- `frontend/js/student/test.js` — pre-flight gate, violation reporting/handling, 5-min warning
- `frontend/student/test.html` — pre-flight gate, webcam preview, violation modal
- `frontend/css/student.css` — styles for the above (built entirely from your existing design tokens — no new colors/fonts introduced)
- `frontend/admin/test-form.html` + `frontend/js/admin/test-form.js` — "Proctoring & Security" section
- `frontend/admin/results.html` + `frontend/js/admin/results.js` — new columns, richer status badges/filter

Nothing in `frontend/admin/dashboard.html`, `frontend/admin/questions.html`, `frontend/student/entry.html`, or any file not listed above was touched — including your College Name / Designation field labels, your "Online Test Platform" / "JS" branding, and your `api.js` Render/Vercel URL configuration, all of which were preserved exactly as you have them.

One incidental fix: `test-form.js` had a leftover browser-tab title reading "MCQ Test Platform" (the old default) in edit mode, inconsistent with your rebrand everywhere else — corrected to "Online Test Platform" while I was already in that file.

---

## Database migration

**You do not need to run anything manually.** `backend/src/db/migrate.js` runs automatically every time the server starts (including on your next Render deploy) and:

- Adds the new columns to `tests` and `attempts` (all new columns are nullable or have safe defaults — `0`/off for every proctoring flag)
- Creates the new `violations` table
- Checks each column/table's existence first, so it's 100% safe to run against a database that's already been migrated (a no-op) or one that's never seen these changes before

This was verified against a simulated copy of your production schema with real test/attempt data in it — migrated successfully with the pre-existing data completely intact, twice in a row (proving the idempotency), including through actual server restarts.

No changes to your `.env` are required.

---

## API changes

**New endpoint**
```
POST /api/public/attempts/:attemptId/violation
Body: { "type": "tab_switch" | "webcam_off" | "webcam_permission_denied" | "fullscreen_exit" | "devtools_attempt" | "copy_attempt", "details": "optional string" }
Response: { "success": true, "data": { "violationCount": 2, "threshold": 3, "autoSubmitted": false } }
```

**Changed responses (backward compatible — only new fields added, nothing removed/renamed)**
- `GET /api/public/tests/:id/meta` — now includes a `proctoring` object
- `GET/POST` session endpoints — `test.proctoring` config and `attempt.tabSwitchCount` / `webcamViolationCount` / `fullscreenViolationCount`
- `POST/PUT /api/tests` — accepts optional `proctoring_enabled`, `webcam_required`, `fullscreen_required`, `tab_switch_enforced`, `max_webcam_violations`, `max_fullscreen_violations`, `max_tab_switch_violations` (all optional; omitting them defaults to off, exactly like before this update existed)
- `GET /api/tests/:testId/results` — each row now includes `tab_switch_count`, `webcam_violation_count`, `fullscreen_violation_count`, `submission_reason`, `display_status`; `?status=` filter now also accepts `auto_submitted` and `cheating_detected`

---

## Testing checklist

**Verified automatically (via live server + real HTTP requests, not just read):**
- [x] Fresh install boots cleanly with the new schema
- [x] Migration against a database with pre-existing real data preserves all data, adds new columns with safe defaults, and is idempotent across repeated runs and real server restarts
- [x] Creating a test **without** any proctoring fields (old-style request) defaults everything to off
- [x] Creating a test **with** proctoring fields persists them correctly
- [x] Violation reporting: count increments correctly per type, independently (webcam/fullscreen/tab-switch tracked separately)
- [x] Auto-submit fires exactly when a type's count reaches ITS configured threshold — not before, not for a different type
- [x] A non-enforced test's violations are logged but **never** auto-submit, even well past what would be a threshold on an enforced test
- [x] Reporting a violation against an already-completed attempt is a safe no-op
- [x] Admin results correctly show `display_status`, violation counts, and filter by the new statuses
- [x] CSV and Excel exports include the new columns and correct status labels
- [x] Full regression pass: the original (non-proctored) student flow — entry, timer, autosave, submit, scoring, duplicate-attempt blocking — is unaffected
- [x] Every HTML/CSS/JS file (existing and new) loads correctly with no broken references

**Needs manual verification in a real browser** (webcam/fullscreen/tab APIs can't be exercised through a server-side test):
- [ ] Camera permission prompt appears on the pre-flight screen; preview video actually shows your camera feed
- [ ] Denying camera access shows the "Denied" state and keeps "Begin Test" disabled
- [ ] Unplugging your webcam (or revoking the permission from the browser's UI) mid-test triggers a warning within a few seconds
- [ ] "Enter Fullscreen" button actually enters fullscreen; pressing Esc triggers the exit warning
- [ ] Clicking "I Understand" on a fullscreen-exit warning returns you to fullscreen
- [ ] Switching to another browser tab, minimizing the window, and alt-tabbing to another app each register as a tab-switch warning
- [ ] Reaching each threshold (2 webcam / 2 fullscreen / 3 tab-switch by default) auto-submits and redirects to the result page
- [ ] Pressing F12, Ctrl+Shift+I, Ctrl+U, Ctrl+A, etc. during a test shows a toast and is blocked
- [ ] On a test with proctoring OFF (or an old test created before this update), none of the above triggers — the test behaves exactly as before
- [ ] Test this in each browser you expect students to use — camera/fullscreen permission UX (and in rarer cases, availability) varies between Chrome, Firefox, Safari, and mobile browsers

---

## Deployment

**Nothing changes about how you deploy.** This is still the same single Express server serving both the API and (when not split) the static frontend, so your existing Render + Vercel setup needs no reconfiguration:

1. Push these changes to the branch your Render service watches.
2. Render redeploys automatically (or trigger a manual deploy). The migration runs on that deploy's first startup — no manual database step.
3. If your frontend is deployed separately on Vercel, push/redeploy that too, so it picks up the changes to `test.html`, `test.js`, `test-form.html`, `results.html`, etc.
4. No new environment variables are required.

One thing worth double-checking on Render specifically: if your webcam-monitored tests will be used in production, verify your Render service is served over **HTTPS** (it is, by default, on Render's provided domain) — `getUserMedia()` (camera access) is blocked by browsers on plain HTTP for any origin other than `localhost`.
