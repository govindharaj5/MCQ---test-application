# MCQ Test Web Application

A complete, self-hosted platform for creating timed multiple-choice tests, sharing a single link with students, and automatically grading and reporting results — built with Node.js/Express and vanilla HTML/CSS/JS (no build step, no framework lock-in).

> **Updated with exam-integrity features** (webcam monitoring, tab-switch detection, fullscreen enforcement, violation logging). See **[PROCTORING_UPDATE.md](./PROCTORING_UPDATE.md)** for what changed, the modified-files list, migration notes, and a testing checklist. Everything below still applies unchanged.

---

## Contents

1. [Features](#features)
2. [Tech stack & key decisions](#tech-stack--key-decisions)
3. [Folder structure](#folder-structure)
4. [Prerequisites](#prerequisites)
5. [Local setup](#local-setup)
6. [Default admin login](#default-admin-login)
7. [How it works](#how-it-works)
8. [Database schema](#database-schema)
9. [API reference](#api-reference)
10. [Security notes (please read)](#security-notes-please-read)
11. [Deployment](#deployment)
12. [Swapping the database](#swapping-the-database-mysql--postgres--firestore)
13. [Troubleshooting](#troubleshooting)

---

## Features

**Admin panel**
- Secure admin login (JWT-based)
- Create unlimited tests, each with its own name, question count, marks-per-question, duration, and start/end window
- Add / edit / delete questions (4 options + 1 correct answer each)
- Unique, shareable test link generated per test
- Dashboard with per-test and site-wide stats
- Results table per test with **search + status filter** (including Auto Submitted / Cheating Detected)
- Per-student violation counts (tab switches, webcam, fullscreen) and a full violation audit log
- **Optional, per-test proctoring**: webcam monitoring, fullscreen enforcement, tab-switch detection — each independently toggled, off by default (see PROCTORING_UPDATE.md)
- Export results as **CSV** and **Excel (.xlsx)**

**Student side**
- Entry form: Name, Register Number / Employee ID, Mobile Number
- One attempt per register number, enforced server-side
- Countdown timer that **survives page refresh** (server-computed deadline, not a client-side counter), with a 5-minutes-remaining warning
- Auto-submits the instant time runs out — even if the browser tab was closed (see [How it works](#how-it-works)) — or the moment a proctoring violation limit is reached
- One-question-at-a-time layout with a question navigator palette
- Confirmation dialog before final submission
- Deterrents against copy/paste, right-click, text selection, and common DevTools shortcuts, with a visible warning on each blocked attempt

**Test availability window**
- Opening the link before the start time shows **"Test has not started yet."**
- Opening the link after the end time shows **"This test has expired."**
- Both are enforced on the server, not just hidden in the UI

**Dashboard analytics**
- Total students attended, highest/average/lowest score, completed count, in-progress count

**UI**
- Light & dark mode (persisted, respects system preference on first visit)
- Fully responsive, mobile-first layouts
- Toast notifications, loading states, and confirmation modals throughout

---

## Tech stack & key decisions

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (via `better-sqlite3`) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| Frontend | Vanilla HTML/CSS/JS (ES modules, no bundler) |
| Exports | `exceljs` (.xlsx), hand-rolled CSV |

**Why SQLite instead of Firebase Firestore or MySQL?** The brief allowed either "Firebase Firestore (or MySQL if easier)". SQLite is a real relational SQL database — the schema, joins, and transactional guarantees you want for exam scoring all apply — but it needs **zero external setup**: no cloud project, no credentials, no separate database server to install and run. `npm install && npm start` is all it takes. The entire data-access layer (`backend/src/models/*.js`) is plain parameterized SQL, so moving to MySQL/Postgres or Firestore later is a contained, well-isolated change — see [Swapping the database](#swapping-the-database-mysql--postgres--firestore).

---

## Folder structure

```
mcq-test-app/
├── backend/
│   ├── server.js                 # Entry point
│   ├── package.json
│   ├── .env.example              # Copy to .env
│   ├── data/                     # SQLite file lives here (gitignored)
│   └── src/
│       ├── app.js                # Express app setup, middleware, static hosting
│       ├── db/
│       │   ├── index.js          # Connection, schema init, admin seeding
│       │   └── schema.sql
│       ├── models/                # Admin, Test, Question, Attempt, Answer
│       ├── controllers/           # auth, test, question, public, result
│       ├── services/
│       │   └── attemptService.js  # Shared submit/auto-submit-on-expiry logic
│       ├── routes/
│       ├── middleware/            # auth guard, rate limiting, error handler
│       └── utils/                 # jwt, validators, scoring/timer math, exporters, id generator
├── frontend/
│   ├── index.html
│   ├── admin/                     # login, dashboard, test-form, questions, results
│   ├── student/                   # entry, test, result
│   ├── css/                       # variables (design tokens), base, components, admin, student
│   └── js/
│       ├── api.js, theme.js, toast.js, security.js, format.js
│       ├── admin/                 # one script per admin page + shared auth guard
│       └── student/                # one script per student page
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js 18 or newer** (tested on Node 22) — [nodejs.org](https://nodejs.org)
- npm (bundled with Node.js)

No database server, Docker, or cloud account is required to run this locally.

---

## Local setup

```bash
# 1. Move into the backend folder
cd mcq-test-app/backend
# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
```

Open `backend/.env` and set at least these two values before first run:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-real-password
JWT_SECRET=any-long-random-string
```

```bash
# 4. Start the server
npm start
```

You should see:

```
============================================================
  MCQ Test Application — server running
  Local:    http://localhost:5000
  Database: /path/to/backend/data/mcqtest.db
============================================================
```

Open **http://localhost:5000** in your browser. The database file and admin account are created automatically on first run — there is no separate migration or seed step to run by hand.

> `npm run dev` runs the server with `node --watch` for auto-restart while you edit backend code.

---

## Default admin login

The admin account is seeded from your `.env` file the first time the server starts:

- **Username:** whatever you set as `ADMIN_USERNAME` (default `admin`)
- **Password:** whatever you set as `ADMIN_PASSWORD`

Go to `/admin/login.html` to sign in.

> **Important:** editing `.env` *after* the first run will **not** change an already-seeded account (this is intentional, so a redeploy can't silently reset your production password). To change your password, use **Change Password** via the `PUT /api/auth/change-password` endpoint, or delete `backend/data/mcqtest.db` to force a completely fresh reseed (this also wipes all tests/results, so only do this for a fresh local dev reset).

---

## How it works

**The unique test link.** Creating a test generates a short random ID (e.g. `KGba5kBUMd`). The shareable link is `https://yourhost.com/test/KGba5kBUMd`. Opening it always re-checks the test's live status server-side.

**Refresh-proof timer.** When a student starts a test, the server computes a hard deadline once: `end_at = min(now + duration_minutes, test.end_time)`. Every page load, refresh, or reconnect re-reads "remaining time" as `end_at − now`, computed fresh on the server — never a client-side counter that could reset or drift. The value is also snapshotted into the database on every autosave, so it's directly inspectable/auditable there too.

**Auto-submit that survives a closed tab.** If the student closes the browser instead of clicking Submit, the attempt is *not* silently stuck as "in progress" forever. Any subsequent request that touches that attempt (the periodic client resync, a later autosave, or the admin simply loading the results page) checks whether `end_at` has passed and, if so, scores and finalizes it server-side automatically. This was tested by starting an attempt on a 1-minute test, waiting 65 real seconds without any client interaction, then confirming the attempt was auto-completed with a correctly-capped time-taken value.

**One attempt per student.** Enforced by a unique database constraint on `(test_id, register_number)` (case-insensitive), not just a UI check. Re-opening the link resumes an in-progress attempt rather than blocking it (so an accidental refresh never locks a student out mid-test), but a *completed* attempt is always rejected.

**Autosave.** Every answer selection is saved to the server immediately (not batched on a fixed timer), which is strictly more reliable than a periodic-only save — the student is never more than one click away from a persisted answer.

---

## Database schema

```
admins        (id, username, password_hash, created_at)
tests         (id, title, description, total_questions, marks_per_question,
               duration_minutes, start_time, end_time, is_active, created_at, updated_at)
questions     (id, test_id, question_text, option_a..d, correct_option, order_index)
attempts      (id, test_id, student_name, register_number, mobile_number,
               start_time, end_at, submitted_at, time_taken_seconds,
               remaining_time_seconds, score, total_marks, percentage, status)
answers       (id, attempt_id, question_id, selected_option, updated_at)
```

Full definitions with comments live in `backend/src/db/schema.sql`. Foreign keys cascade on delete, so deleting a test cleans up its questions, attempts, and answers automatically.

---

## API reference

All admin routes require `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Admin login |
| GET | `/api/auth/me` | Verify current session |
| PUT | `/api/auth/change-password` | Change admin password |
| GET/POST | `/api/tests` | List / create tests |
| GET/PUT/DELETE | `/api/tests/:id` | Read / update / delete a test |
| GET/POST | `/api/tests/:testId/questions` | List / add questions |
| PUT/DELETE | `/api/tests/:testId/questions/:id` | Edit / delete a question |
| GET | `/api/tests/:testId/results?search=&status=` | Results table (filterable) |
| GET | `/api/tests/:testId/stats` | Per-test stats |
| GET | `/api/tests/:testId/export/csv` \| `/export/xlsx` | Downloads |
| GET | `/api/dashboard/overview` | Site-wide stats |
| GET | `/api/public/tests/:id/meta` | Test status check (no auth) |
| POST | `/api/public/tests/:id/start` | Begin/resume an attempt |
| GET | `/api/public/attempts/:id/session` | Rehydrate full state (used on every load/refresh) |
| PUT | `/api/public/attempts/:id/answer` | Autosave one answer |
| POST | `/api/public/attempts/:id/submit` | Final submission |
| POST | `/api/public/attempts/:id/violation` | Report a proctoring event (tab switch, webcam, fullscreen, blocked action) — see PROCTORING_UPDATE.md |

---

## Security notes (please read)

- **Passwords** are hashed with bcrypt; **sessions** use signed, expiring JWTs.
- **Rate limiting** is applied to the login endpoint (20 attempts / 15 min / IP) and lightly to all public endpoints.
- **Answers are never sent to the browser.** The public question payload excludes `correct_option` entirely — scoring happens only on the server, against the database's own copy of the correct answers.
- **Client-side exam restrictions are best-effort, not a security boundary.** Disabling right-click, copy/paste, text selection, and shortcuts like F12 / Ctrl+Shift+I / Ctrl+U raises the bar against *casual* copying, but any client-side JavaScript restriction can be bypassed by a sufficiently determined user (disabling JS, browser remote-debugging protocols, a second device, etc.). This is a well-known, inherent limitation of any browser-based exam tool, not a bug — the actual integrity guarantees (correct one-attempt enforcement, tamper-proof timer, server-side scoring) all live on the server, where they can't be bypassed by the browser.
- **Known transitive advisory:** `exceljs` pulls in an old `uuid` version with a moderate advisory (`GHSA-w5hq-g745-h8pq`, a buffer-bounds issue only triggered by a manually-supplied buffer, which this codebase never does). Run `npm audit` for details if you want to track it; fixing it today requires downgrading `exceljs` to a much older major version, which is a worse trade-off than the advisory itself for this use case.

---

## Deployment

### Option A — Easiest: Render.com (single service, free tier)

This app is one Node/Express server that also serves the frontend's static files, so it deploys as a single web service.

1. Push this project to a GitHub repository.
2. On [render.com](https://render.com), click **New → Web Service** and connect the repo.
3. Set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables from `.env.example` under the service's **Environment** tab (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, etc).
5. Deploy. Your app is live at the URL Render gives you.

> **Caveat:** Render's free tier disk is not guaranteed to persist across redeploys. For a class project or short-lived assessment this is usually fine; for long-term production use, add a [Render persistent disk](https://render.com/docs/disks) mounted at `backend/data`, or switch to a hosted database (see below).

### Option B — Firebase Hosting or Vercel, as the brief requested

Firebase Hosting and Vercel are both built around **static files and serverless functions** — they don't run a persistent Express server with a local SQLite file the way Render does. To use them as asked, split the deployment:

1. **Frontend → Firebase Hosting or Vercel.** Deploy the contents of `frontend/` as a static site.
   - Firebase: `firebase init hosting` (set public directory to `frontend`), then `firebase deploy`.
   - Vercel: `vercel` from inside `frontend/` (framework preset: "Other").
2. **Backend → any Node host** (Render, Railway, Fly.io, a small VM, etc). Deploy `backend/` there the same way as Option A.
3. Set `CORS_ORIGIN` in the backend's `.env` to your deployed frontend URL.
4. In `frontend/js/api.js`, change the `fetch('/api...)` base to your deployed backend's full URL (e.g. `https://your-backend.onrender.com/api...`), since frontend and backend are no longer on the same origin.
5. For the database on a serverless-style host, use a hosted SQL database (e.g. Turso/libSQL, Supabase/Postgres, PlanetScale/MySQL) instead of a local SQLite file, since serverless filesystems aren't persistent — see the next section for how contained that change is.

### Deploying to a VM / your own server

Standard Node deployment: `git clone`, `npm install --omit=dev`, set `.env`, run behind a process manager (`pm2 start server.js`) and a reverse proxy (Nginx/Caddy) for TLS.

---

## Swapping the database (MySQL / Postgres / Firestore)

Every query lives in `backend/src/models/*.js` as small, self-contained functions (e.g. `Test.create()`, `Attempt.findByTestAndRegister()`) — nothing elsewhere in the app touches SQL directly. To swap engines:

1. Replace the `better-sqlite3` connection in `backend/src/db/index.js` with your driver of choice (`mysql2/promise`, `pg`, or the Firestore Admin SDK).
2. Rewrite the query bodies inside `backend/src/models/*.js` to match — the function names and return shapes controllers rely on stay the same, so controllers/routes need no changes.
3. Recreate `backend/src/db/schema.sql` as your engine's migration (for Firestore, this becomes collection/document design instead of tables — `tests`, `questions`, `attempts`, and `answers` map naturally to top-level collections with `test_id`/`attempt_id` reference fields).

---

## Troubleshooting

- **`better-sqlite3` fails to install / build:** make sure you're on Node 18+; `npm install` needs to download a prebuilt binary for your platform. If you're on an unusual platform without prebuilds, you'll need Python + a C++ toolchain for it to compile from source.
- **"Test has not started yet." / "This test has expired." shows unexpectedly:** the start/end times are stored in UTC and displayed in the browser's local timezone. Double-check the test's configured start/end time on the Edit Test page.
- **Port already in use:** change `PORT` in `.env`.
- **Forgot the admin password:** either use `PUT /api/auth/change-password` while still logged in on another device/tab, or stop the server and delete `backend/data/mcqtest.db*` to force a fresh reseed from `.env` (this wipes all data).

---

Built as a complete reference implementation — every feature listed above has been implemented and functionally tested end-to-end, including a real-time test of the timer expiring and auto-submitting a live attempt.
