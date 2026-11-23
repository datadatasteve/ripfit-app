# RipFit Phase 0A-1: Build Results

Run date 2026-11-22. **Status: all sections (02 to 08) built and tested locally. Nothing after checkpoint 1 (`867ad78`) is committed.**

**Test environment.** A throwaway Postgres 14 cluster in the session scratchpad, with the database session `timezone = UTC` to match Northflank. Migrations 001 to 029 were run, then old-format seed data was loaded (17 workouts covering every backfill branch, a program, routines, an Aug 11 hike, the 11/2 rows and a second user). The seed also adds the four production shell-change columns by hand, without FKs, as on production. Then the real `migrate.js` ran (030, 031), the backend ran with `TZ=UTC`, Vite ran from the shell, and the UI was driven in the in-app browser. "UI" below means clicked through in the browser; "API" means real HTTP calls against the running backend; "DB" means checked in Postgres.

## Production incident during the run (read first)

Checkpoint 1 (migration 030 alone) was deployed before the code that sets `status` on insert. 030 drops the `status` default and sets `NOT NULL`, so every workout start on production (routine, program, open session, quick cardio, meditation save) will fail with a not-null error until this full build is deployed.

- **Immediate fix (Northflank Postgres shell):** `ALTER TABLE workouts ALTER COLUMN status SET DEFAULT 'in_progress';`. With this default the deployed old code behaves correctly: start → `in_progress`, finish → `completed`, cancel → `cancelled`.
- **Permanent fix:** this build. New migration **031** removes that default again once every insert sets status. 030 can't be edited, because it is already recorded as run on production. Tested: a DB at 030 with the shell default applied, then 031, ends with no default and `NOT NULL`.
- **Backfill already ran on production** when 030 deployed. Running `report-status-backfill.js` now shows the result against current data.

## Completed

| Section | What | Verified |
|---|---|---|
| 02 Audit | A1 to A4 (below) | code reading, `grep` |
| 03 Migration | `030_workout_status_lifecycle.sql` (committed at checkpoint 1) | DB: seeded and fresh runs; re-run is a no-op |
| 04 Lifecycle | All 4 insert paths set status; finish completes only with activity, else cancels with the message; cancel keeps data with `end_time` NULL; stale sweep; `031` drops the default | UI + API + DB |
| 05 Stats filtering | Every A3 read path filters `status='completed'` (exceptions as specified); History tags; detail banner | UI + API |
| 06 Time zone / duration | Root causes found and fixed; `users.timezone` set from the browser; one shared duration definition | UI + API + DB |
| 07 Scripts | `report-status-backfill.js`, `cleanup-hike-and-1102.js`, `dump-schema.js` | DB, both modes |
| 08 Schema doc | `db-schema.md` regenerated from migrations 001 to 031 (33 tables) | generated from DB |

### Test checklist

| # | Result | How verified |
|---|---|---|
| T1 | **PASS** | DB. Fresh DB: 001 to 031 run cleanly; a second `migrate.js` run executes nothing. Re-applying 030's SQL directly with `psql -f` also succeeds and changes nothing. 031 also tested against the production shape (030 plus the shell default). |
| T2 | **PASS** | DB. All 17 seed rows got the expected status (table below). Cardio-segment-only and both meditation shapes stay `completed`. |
| T3 | **PASS** | UI. Routine start → `in_progress`. Log a set, finish → `completed` with `end_time`. Program start, log a set, Cancel → `cancelled`, set kept, `end_time` NULL, no `program_workouts` row. Open session finished with nothing → alert "Nothing was logged, so this workout was cancelled." and status `cancelled`. API: the same four cases, plus an insert without status fails `NOT NULL`. |
| T4 | **PASS** | UI + API. Overview totals, calendar, strength, records, exercise deep dive and routine `use_count` exclude cancelled and in-progress rows. `last_performance` on routine start used the last *completed* session (5×185), not the newer cancelled one (225); seen in the UI prefill. Overload uses the same `last_performance`. The program card shows "Next: Shoulder Day, 33%"; the abandoned program day with a stray `program_workouts` row is ignored. Progress, `completed_workouts` and day `completed_workout_id` all count completed only. |
| T5 | **PASS (Stats History, detail) / API-only (workout list)** | UI: Stats > History shows "In progress" and "Cancelled" chips; duration shows "—" for them and its charts use completed sessions only. The detail page shows the Cancelled banner and the In progress banner. The workout list (`WorkoutHistory.jsx`) is only rendered in the Admin panel; the test user isn't an admin, so it was checked by API only (`/workouts/history` returns every status, and the component renders the same chips). |
| T6 | **PASS** | API + DB. A workout 25 h old (sets also 25 h old) was swept to `cancelled` on the next `GET /workouts`; one 23 h old was untouched. |
| T7 | **PASS, with a doc correction** | UI + API. With the user on America/New_York, the workout starting 03:30 UTC on 11/20 appears in the **10 pm** bucket of When You Train, and its `workout_date` stays 2026-11-19. The doc's "11 pm" assumes daylight time; on 11/19 New York is UTC−5, so 03:30 UTC is 10:30 pm. Nothing lands between midnight and 4 am. |
| T8 | **PASS** | UI + API. The Avg Session Duration chart is non-zero and matches the shared definition: Aug 10 week 285 m = (27000+7200)/2/60; Nov 2 week 18 m; Nov 9 week 55 m. |
| T9 | **PASS** | DB. Report on the pre-030 seed: 10 completed / 1 in progress / 6 cancelled, matching T2, and it lists the 4 cancelled-with-sets rows. Cleanup dry run: row counts unchanged. `--confirm`: deleted 11/2 rows 12, 13, 16 and the hike `cardio_sessions` row, kept 14 (45 min) and 15 (non-shoulder); orphans 0 → 0. Two hike candidates: nothing deleted. A `program_workouts` row on a phantom was deleted. A failure forced mid-transaction (trigger) rolled everything back. An unknown email exits without changes. |
| T10 | **PASS (API)** | API. Created a routine with a superset pair, started it, logged both superset sets (`set_type='superset'`), edited a set (`PATCH /workouts/sets/:id` → 10×140), finished it. Barcode lookup against a locally seeded food (`POST /nutrition/foods/barcode/:code` → `source: database`); food search works. Barcode **camera scanning** and the in-workout edit **UI** were not exercised. |

T2 seed detail (migration 030 on the old-format seed):

| Row | Shape | Got |
|---|---|---|
| W1 | end + sets | completed |
| W2 | no end, 2 h old | in_progress |
| W3 | no end, 36 h old, 1 set | cancelled |
| W4 | end, no activity | cancelled |
| W5 | end, cardio segment only | completed |
| W6 | meditation, `duration_seconds=600` | completed |
| W7 | meditation, no `duration_seconds`, 2 s span | completed |
| W8 | explicitly cancelled, end + sets | cancelled (Decision 1) |
| W9 | program workout, finished | completed |
| W10 | program workout, abandoned, has a `program_workouts` row | cancelled |
| W11 | 03:30 UTC 11/20, date 11/19 | completed |
| W12, W14, W15 | 11/2 finished | completed |
| W13, W16 | 11/2 never finished | cancelled |
| W17 | other user | completed |

## Failed / Incomplete

- None of the doc's items failed.
- **Not exercised:** barcode camera scanning on a phone, the in-workout set-edit UI (API only), the Admin workout list UI (API only), drag/drop and timers (out of scope). Real-phone checks are the owner's section 10 step 3.
- **Pre-existing jest failures (not caused by this run):** `backend/tests/app.test.js` has 2 of 3 tests failing. `GET /api/v1` and the unknown-route 404 both return 401, because `statsRoutes` (auth on every route) is also mounted at `/api/v1` (`app.js:76`). Routing was not touched.

## Needs Follow-up

1. **Production: run the one-line default fix now** (see the incident section), then deploy this build.
2. **Quick-cardio workouts open the wrong detail page.** A `workouts` row with `workout_type='cardio'` is listed as type `cardio`, and the detail page then fetches `/cardio/:id` (the `cardio_sessions` table) instead of `/workouts/history/:id`. This is pre-existing and not fixed here; it can show the wrong record or "No data".
3. **Previous-notes dropdown can show an empty cancelled session.** As the doc specifies, it shows the most recent prior session with the exercise, cancelled included. An empty finish (now cancelled) therefore hides older notes: seen in the UI, where the "last session" was an empty cancelled test workout. This fits the 0A-2 "incomplete" indicator work.
4. **Timestamp columns depend on the DB session time zone.** Program start and `logWorkout` use `NOW()`, and `workout_sets.created_at` defaults to `CURRENT_TIMESTAMP`, all into `timestamp without time zone`. That is only UTC if the session TimeZone is UTC. `dump-schema.js` prints it; confirm production says UTC. (Locally, a recreated test DB defaulted to America/New_York and program starts showed a 5 h clock.)
5. **Meditation is counted in `/stats/combined`** (the calendar dot, Overview pies, the Combined tab and the Avg Session Duration line) but excluded from Overview totals and weekly frequency. This was already true and was left as is; decide which is intended.
6. A meditation row logged before migration 027 has a ~2 s duration (no stored length). Shown as-is.
7. `program_workouts` has no unique constraint. Finish now inserts only `WHERE NOT EXISTS` for that workout, but `/complete` still uses a no-op `ON CONFLICT DO NOTHING`.

## Schema changes made

Migration numbers confirmed: the highest before this run was `029_rep_ranges.sql`.

**030 `030_workout_status_lifecycle.sql`** (committed in `867ad78`, already deployed). Exact SQL is in the file:
- `workouts`: `ADD COLUMN IF NOT EXISTS program_id integer`, `program_routine_id integer`, `paused_at timestamptz`, `total_paused_seconds integer DEFAULT 0`; `ALTER COLUMN total_paused_seconds SET DEFAULT 0`.
- FKs, each added only if that column has no FK yet: `workouts_program_id_fkey` → `programs(id)` and `workouts_program_routine_id_fkey` → `program_routines(id)`, both `ON DELETE SET NULL NOT VALID`.
- Status backfill `UPDATE` (rule below), then guarded `CHECK workouts_status_allowed (status IN ('in_progress','completed','cancelled'))`.
- `ALTER COLUMN status DROP DEFAULT; ALTER COLUMN status SET NOT NULL;`
- `users`: `ADD COLUMN IF NOT EXISTS timezone text`.

**031 `031_workout_status_no_default.sql`** (new, not committed):
```sql
ALTER TABLE workouts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE workouts ALTER COLUMN status SET NOT NULL;
```

## Files changed (since checkpoint 1)

New:
- `backend/database/migrations/031_workout_status_no_default.sql`
- `backend/src/utils/workoutStatus.js`: shared `activitySql`, `durationSql`, `lastActivitySql`, `localTimeSql`, `userTimezoneSql`, `isValidTimezone`, `sweepStaleWorkouts`, `workoutHasActivity`
- `backend/scripts/one-off/report-status-backfill.js`, `cleanup-hike-and-1102.js`, `dump-schema.js`
- `db-schema.md`: in the repo root. The old copy in the Obsidian vault (`9.11 Build Docs/db-schema.md`) was not touched; replace it with this one if wanted.

Modified:
- `backend/src/controllers/workoutController.js`: status on insert (`logWorkout` completed, `startFreeLift` in_progress); finish (transaction, activity check, empty → cancelled + message, stores `total_paused_seconds`, `program_workouts` only on complete); cancel (no `end_time`); stale sweep in `getWorkouts` and `getCombinedHistory`; history returns every status with string dates and the shared duration; detail returns the shared duration; previous notes exclude the current workout and include cancelled.
- `backend/src/controllers/routineController.js`: routine start inserts `in_progress`; `last_performance` uses completed only.
- `backend/src/controllers/programController.js`: program start inserts `in_progress`; `last_performance` uses completed only; every `program_workouts` read (list, detail, next-up, active, progress, achievement, stats silo) counts only completed workouts; `/complete` refuses a non-completed workout (409); shared duration.
- `backend/src/controllers/statsController.js`: completed only everywhere (removed the `OR status IS NULL` branches); hour and day-of-week in the user's zone; weekly buckets on the local date; shared duration; `/combined` returns `YYYY-MM-DD` dates, `status`, and `include_unfinished=1` for History.
- `backend/src/controllers/profileController.js`: `timezone` readable on `GET /users/me` and writable via `PUT /users/me/preferences` (validated in Node and against `pg_timezone_names`).
- `backend/src/controllers/adminController.js`: `workout_count` counts completed; shared duration.
- `frontend/src/App.jsx`: sends the browser time zone when it is unset or has changed.
- `frontend/src/components/ActiveWorkout.jsx`: finish sends `total_paused_seconds`, handles the empty-finish cancel message, and shows an error if finish fails; previous-notes request passes `workoutId`.
- `frontend/src/components/StatsCenter.jsx` / `.css`: week matching parses local dates (the 0m fix); History requests unfinished rows, tags them, and keeps its charts on completed rows only.
- `frontend/src/components/WorkoutHistory.jsx`: status chips.
- `frontend/src/components/WorkoutDetailPage.jsx` / `.css`: Cancelled and In progress banners.
- `results.md`: this file.

## Audit findings

### A1. Active workout state

- **Where it lives:** React state only. `activeWorkout` is a `useState` in `frontend/src/App.jsx`, passed to `ActiveWorkout.jsx`. Nothing about the in-progress workout goes to localStorage or sessionStorage; those hold the token, theme, routine sort, timer audio, tempo toggles and meditation presets.
- **Lost on refresh, or when the OS kills a backgrounded tab:** the whole in-progress session. That is the active-workout pointer, exercise order, the client copy of `logged_sets`, unsaved exercise notes and workout notes (saved only on finish), the pending rating, unsaved cardio segment inputs, timers, and pause state. The server keeps the `workouts` row, `workout_exercises` and every posted set or segment, but **nothing fetches them back**: there is no get-active-workout endpoint.
- **Pause is client-only.** `paused_at` and `total_paused_seconds` are set only in React (`ActiveWorkout.jsx` `togglePause`). No route wrote them before this run; finish now stores the total.
- **Backgrounding:** no `visibilitychange`, `pagehide` or `beforeunload` handling for workouts (`MeditationTimer.jsx` only holds a wake lock). Nothing is cancelled server-side; the row is orphaned and, after this run, swept to `cancelled` after 24 h without activity.
- **Server calls:**
  - **Start:** `POST /routines/:id/start-workout`, `POST /programs/:pid/days/:prid/start`, or `POST /workouts/start-free` (open, quick cardio, meditation), then `PUT /workouts/:id/type`. Quick cardio adds `POST /workouts/:id/exercises` and an optional `PUT /notes`.
  - **Each set:** `POST /workouts/:id/sets` (edits: `PATCH /workouts/sets/:id`). Segments: `POST /workouts/:id/exercises/:eid/cardio-segments`.
  - **Pause:** none.
  - **Finish:** a `PUT …/exercises/:eid/notes` per exercise, `PUT /notes`, `PUT /finish`, an optional rating `PUT`, and `GET /programs/:id`.
  - **Cancel:** `PUT /workouts/:id/cancel`.

### A2. Built vs not built

| Item | Status | Evidence |
|---|---|---|
| Interval timer | built | `WorkoutTimers.jsx:75-76` `TIMER_MODES`; runner `:257` |
| EMOM | built | `WorkoutTimers.jsx:77` |
| AMRAP | built | `WorkoutTimers.jsx:78`, `:129` |
| Tabata | built | `WorkoutTimers.jsx:79` |
| Custom cooldown per exercise | built | `routine_exercises.cooldown_seconds` (migration 014); override in `ActiveWorkout.jsx` (`baseCooldownFor`, "user's override wins") |
| Video toggle in active workout | built | `WorkoutTimers.jsx:713-735` `VideoPanel` (male/female toggle), opened from `WorkoutTimerBar` |
| Log Set button fixed position | partial | `.log-set-btn` (`ActiveWorkout.css:201`, `:1448`) sits in an inline flex row, not fixed or sticky. Not checked on a phone |
| Previous-notes dropdown | built | `PreviousNotesDropdown` → `GET /workouts/previous-notes` |
| Drag/drop reorder, desktop | built in builders, partial in workout | `SortableList.jsx` (dnd-kit) in RoutineBuilder, ProgramBuilder and MeditationTimer. The active workout uses ↑/↓ buttons (`ActiveWorkout.jsx`, `moveExercise`) |
| Drag/drop reorder, mobile | built in builders, missing in workout | `SortableList.jsx:64` TouchSensor (300 ms hold); the active workout has buttons only |
| Desktop tooltips | partial | `title=` attributes only (for example `SortableList.jsx:21`); no tooltip component |
| Meditation sessions logging to stats | built (own tab) | `MeditationTimer.jsx` start-free + finish with `duration_seconds`. Shown in Stats > Meditation; excluded from Overview totals (`workout_type <> 'meditation'`) |
| Desktop nav timer during workout | built | `NavElapsedClock` in `App.jsx`, toggled by `showNavClock` |
| Timer-type picker location | built: inside the per-exercise timer bar | `WorkoutTimerBar` / `InlineTimer`; block-mode timer opened from the workout header |
| Tempo pre-timer countdown | missing / unclear | `TempoGuide.jsx` runs a phase countdown, but no lead-in before the first rep was found |
| Workout cancels when mobile app is backgrounded | no server cancel; client state lost | No lifecycle handlers (see A1) |

### A3. Read paths (and what this run changed)

Before this run `workouts.status` defaulted to `'completed'`, so every `status='completed'` filter already included in-progress and abandoned workouts. Only Cancel set `'cancelled'`. Every path below now counts `status='completed'` only, except where noted.

| Area | Function | Before | Now |
|---|---|---|---|
| Overview frequency / hour / day / durations / ratings / totals | `statsController.getOverview` | `completed OR status IS NULL` | completed; local zone; shared duration |
| Strength stats | `getStrengthStats` | completed (incl. in-progress) | completed |
| Cardio stats | `getCardioStats` | completed | completed; shared duration |
| Records | `getRecords` | completed | completed |
| Combined (calendar, pies, Combined tab, History tab) | `getCombinedStats` | completed | completed; History passes `include_unfinished=1` and tags rows |
| Exercise deep dive | `getExerciseStats` | completed | completed |
| Meditation tab | `getMeditationStats` | completed | completed; shared duration |
| Workout list / history | `workoutController.getCombinedHistory` | hid cancelled | lists every status (tagged); stale sweep |
| Workout list API | `getWorkouts` | no filter | lists every status, returns `status`; stale sweep |
| Detail | `getWorkoutDetail` | none | none (banner in UI) |
| Last time / `last_performance` | `routineController.startWorkoutFromRoutine`, `programController.startProgramWorkout` | **no filter** | completed |
| Overload suggestion | frontend `computeOverloadSuggestions` | from `last_performance` | inherits the fix |
| Previous notes dropdown | `getPreviousExerciseNotes` | completed with `end_time` | any prior session, cancelled included, excluding the current workout |
| Streaks | none exist | — | — |
| Session counts | `routineController.getRoutines` `use_count`; `adminController.listUsers` `workout_count` | completed; admin: none | completed |
| Program next-up / counts / progress / achievement / stats silo | `programController` (7 queries) | any `program_workouts` row | only rows whose workout is completed |

`program_workouts` rows are written at finish and via `POST /programs/:id/days/:prid/complete`, never at start. Both now require a completed workout.

### A4. Cancel before this run

`PUT /workouts/:id/cancel` set `status='cancelled'` **and `end_time = now`**, deleted nothing, and the client dropped local state regardless. Program next-up didn't count a cancelled workout (no `program_workouts` row), but it did count anything recorded via `/complete` or "finished" with nothing logged. `last_performance` did not exclude cancelled workouts.

## Root causes (section 06)

- **"When You Train" shows 30+ entries between midnight and 4 am:** `start_time` is `timestamp without time zone` holding UTC, and `EXTRACT(HOUR FROM start_time)` bucketed it as-is. An 8 pm Eastern workout is 00:00 or 01:00 UTC. Fixed: `(start_time AT TIME ZONE 'UTC') AT TIME ZONE users.timezone`. `cardio_sessions.start_time` is `timestamptz` and is converted with `AT TIME ZONE` directly. `workout_date` comes from the browser's local date (`ActiveWorkout.jsx` `localDate`), so it agrees with the local day of the converted `start_time`. Checked on W11: local 2026-11-19 22:30, date 2026-11-19.
- **Average session duration shows 0m:** `/stats/combined` returned `workout_date` as a JS Date, serialised to `2026-11-19T00:00:00.000Z`. `OverviewTab` built `new Date(s.date + 'T12:00:00')`, which is **Invalid Date**, so no session ever matched a week and every week averaged 0. Fixed on both sides: the API returns bare `YYYY-MM-DD`, and the client slices to 10 characters and parses as local time. Separately, durations were `end_time - start_time` everywhere, ignoring pauses and meditation's `duration_seconds`. Now there is one `durationSql` used by stats, history, detail, program progress and stats, admin, and the scripts.

## Decisions made

1. **Explicitly cancelled rows stay cancelled in the backfill.** The doc's rule would have turned a cancelled workout with an end time (old cancel set `end_time`) and sets into `completed`, counting it in stats.
2. **Meditation "recorded duration"** means `COALESCE(duration_seconds, end_time - start_time) > 0`, so pre-027 sessions count.
3. **`status SET NOT NULL`** as well as no default, so a missing status fails loudly instead of being NULL.
4. **FKs are `NOT VALID` and `ON DELETE SET NULL`**: no deploy failure on stray ids, and history survives program deletion.
5. **Migration 031 was added**, because 030 shipped alone and production needed a temporary default.
6. **Stale sweep trigger points.** No "fetch active workout" endpoint exists (that is 0A-2), so the sweep runs when workouts are listed: `GET /workouts`, `GET /workouts/history`, and `GET /stats/combined?include_unfinished=1`. T6 was verified through `GET /workouts`.
7. **Finish stores `total_paused_seconds`** (sent by the client) and clears `paused_at`. Without that, the doc's duration definition would always subtract 0. Pause and resume themselves are unchanged.
8. **Empty finish** sets `cancelled` with `end_time` NULL, matching cancel, and returns `cancelled_empty: true` plus the message. The client shows it with `alert`, as the app already does for start errors.
9. **Previous notes:** dropped the `completed` + `end_time` filter (cancel no longer sets `end_time`) and added the `workoutId` exclusion. The Exercise Notes panel's "Previous workout notes" comes from `last_performance`, so it now shows the last *completed* session.
10. **Time zone endpoint:** reused `PUT /users/me/preferences` instead of adding `PATCH /users/me/timezone`. The value is checked in Node and against `pg_timezone_names`, so an unknown zone can't break stats queries.
11. **Weekly frequency and the weeks window** use the local `workout_date` / `session_date` instead of the UTC timestamp.
12. **History "Duration" shows "—"** for cancelled and in-progress rows. The Stats > History charts use completed rows only.
13. **Admin user list:** `workout_count` counts completed only; `last_active` still considers any workout.
14. **Cleanup script with zero or several hike candidates** deletes nothing at all (11/2 included), following "exit without deleting" literally. The 11/2 plan is still printed. The orphan check compares before and after, so orphans that already exist on production can't block it, but any new orphan rolls back.
15. **`db-schema.md` is written to the repo root.** The vault copy is left alone. `results.md` is in the repo root as the doc says (earlier briefs used the vault).
16. **Out-of-scope changes reverted during the run:** briefly excluded meditation from `/stats/combined`, then restored it to keep the existing behaviour (Follow-up 5).

## Notes for run 0A-2

- **Where state lives:** only in `App.jsx` React state (`activeWorkout`). The server already holds the durable parts: the `workouts` row with `status='in_progress'`, `workout_exercises`, every set (`workout_sets.created_at`) and segment. Not on the server: exercise order changes after start (in `order_index` only for added exercises), unsaved notes, the pending rating, timers and pause.
- **Recommended approach:**
  1. Add `GET /workouts/active`. It runs `sweepStaleWorkouts` first, then returns the newest `in_progress` workout with exercises, logged sets and segments, `last_performance` and template data. The response should match the start endpoints' shape so `setActiveWorkout(data)` can take it directly.
  2. Call it on app load; when a workout comes back, show a resume prompt (resume / cancel).
  3. Persist pause on the server: `PUT /workouts/:id/pause` and `/resume` writing `paused_at` / `total_paused_seconds` (the columns exist now).
  4. Autosave notes: debounced `PUT …/notes` as the user types, instead of only on finish. Optionally keep a localStorage draft keyed by workout id for anything not yet sent.
  5. Resume after cancel: set back to `in_progress`, and count the cancel→resume gap as paused time (add it to `total_paused_seconds`) so duration excludes it.
  6. Add `visibilitychange`/`pagehide` handling to flush pending writes. Don't cancel on background.
- The "incomplete" indicator for previous notes should flag a non-completed source; see Follow-up 3.
- Reuse `backend/src/utils/workoutStatus.js` (`activitySql`, `durationSql`, `lastActivitySql`, `sweepStaleWorkouts`) instead of new copies.
