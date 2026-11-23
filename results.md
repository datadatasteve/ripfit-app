# RipFit Phase 0A-1: Build Results

Run started 2026-11-22. **Status: paused at commit checkpoint 1** (migration 030 written and tested). Sections 04 to 08 are not started yet. This file is updated at each checkpoint.

Test environment: throwaway Postgres 14 cluster in the session scratchpad (port 55432, database and session `timezone = UTC` to match Northflank). Migrations 001 to 029 were run, then old-format seed data was loaded, then the real `backend/database/migrate.js` was run with `TZ=UTC`. The seed also adds the four production shell-change columns by hand (no FKs) so that the migration's `IF NOT EXISTS` and FK guards are exercised the same way they will be on production.

## Completed

- **Section 02 audit (A1 to A4):** done, findings below.
- **Section 03 migration:** `backend/database/migrations/030_workout_status_lifecycle.sql`.
  - Seeded DB: runs cleanly. Every backfill branch matches the expected status (see the T2 table). Running `migrate.js` a second time is a no-op. Re-applying the raw SQL directly with `psql -f` also succeeds and changes nothing.
  - Fresh DB: 001 through 030 run cleanly, and a second run executes nothing.

## Failed / Incomplete

- Sections 04 (lifecycle), 05 (stats filtering), 06 (time zone and duration), 07 (scripts), 08 (schema doc) and the full T3 to T10 test pass are not started yet.
- **Deploy blocker until section 04 lands:** migration 030 drops the `status` default and sets `status NOT NULL`. Until section 04 makes every insert path set status, starting a workout would fail against a database migrated to 030. Do not deploy checkpoint 1 on its own.

## Needs Follow-up

- (filled in at later checkpoints)

## Schema changes made

Migration number confirmed: the highest existing migration was `029_rep_ranges.sql`, so this run adds **030**.

`030_workout_status_lifecycle.sql` (exact SQL is in the file). Summary:
1. `workouts`: `ADD COLUMN IF NOT EXISTS` for `program_id integer`, `program_routine_id integer`, `paused_at timestamptz` and `total_paused_seconds integer DEFAULT 0`. Then `SET DEFAULT 0` on `total_paused_seconds` in case production added it without a default.
2. FKs `workouts_program_id_fkey` → `programs(id)` and `workouts_program_routine_id_fkey` → `program_routines(id)`, both `ON DELETE SET NULL NOT VALID`. Each is added only if no FK exists on that column yet (guarded `DO` block, checked via `pg_constraint`).
3. Status backfill, then CHECK `workouts_status_allowed` (`in_progress`, `completed`, `cancelled`), guarded by constraint name.
4. `ALTER COLUMN status DROP DEFAULT` and `SET NOT NULL`.
5. `users.timezone text` (nullable).

## Files changed

- `backend/database/migrations/030_workout_status_lifecycle.sql` (new)
- `results.md` (new)

## Audit findings

### A1. Active workout state

- **Where it lives:** in React state only. `activeWorkout` is a `useState` in `frontend/src/App.jsx:197`, passed down to `ActiveWorkout.jsx`. Nothing about the in-progress workout goes to localStorage or sessionStorage. localStorage only holds the token, theme, routine sort, timer audio, tempo toggles and meditation presets.
- **Lost on refresh or when the tab is killed:** the whole in-progress session. That includes which workout is active, the exercise list and order, `logged_sets` (the client-side copy), unsaved exercise notes (saved only on finish, `ActiveWorkout.jsx:770`), workout notes, the pending rating, cardio segments typed but not saved, timer state, and **pause state**. The server keeps the `workouts` row, the `workout_exercises` rows and every set that was posted. Nothing ever fetches that state back: there is no "get active workout" endpoint. After a refresh, the server row is orphaned with no `end_time`.
- **Pause is client-only.** `paused_at` and `total_paused_seconds` are set only in React (`ActiveWorkout.jsx:1743-1760`). No backend route writes them, so on the server they are always NULL/0. Finish subtracts the paused time only in the client summary (`ActiveWorkout.jsx:848-850`).
- **Backgrounding:** there is no `visibilitychange`, `pagehide` or `beforeunload` handling for workouts. `MeditationTimer.jsx` only holds a wake lock. If mobile Safari or Chrome discards a backgrounded tab, the workout is lost on reload, as above. The server does not cancel anything.
- **Server calls by moment:**
  - **Start:** `POST /routines/:id/start-workout`, `POST /programs/:pid/days/:prid/start`, or `POST /workouts/start-free` (open session, quick cardio, meditation). Then `PUT /workouts/:id/type`. Quick cardio adds `POST /workouts/:id/exercises` and an optional `PUT /notes`.
  - **Each set:** `POST /workouts/:id/sets` (and `PATCH /workouts/sets/:id` for edits). Each cardio segment: `POST /workouts/:id/exercises/:eid/cardio-segments`.
  - **Pause:** no server call.
  - **Finish:** `PUT /exercises/:eid/notes` for each exercise, `PUT /notes`, `PUT /finish` (which also writes `program_workouts`), an optional `PUT /stats/workouts/:id/rating`, and `GET /programs/:id` for overload settings.
  - **Cancel:** `PUT /workouts/:id/cancel`.

### A2. Built vs not built

| Item | Status | Evidence |
|---|---|---|
| Interval timer | built | `WorkoutTimers.jsx:75-76` (`TIMER_MODES`), runner at `:257` |
| EMOM | built | `WorkoutTimers.jsx:77` |
| AMRAP | built | `WorkoutTimers.jsx:78`, `:129` |
| Tabata | built | `WorkoutTimers.jsx:79` |
| Custom cooldown per exercise | built | `routine_exercises.cooldown_seconds` (migration 022/024), override in `ActiveWorkout.jsx:2170` |
| Video toggle in active workout | built | `WorkoutTimers.jsx:713-735` (`VideoPanel`, male/female toggle), opened from `WorkoutTimerBar` (`ActiveWorkout.jsx:2812`) |
| Log Set button fixed position | partial | `.log-set-btn` (`ActiveWorkout.css:201`, `:1448`) sits in an inline flex row (`.aw-log-row`), not fixed or sticky. Not verified on a phone |
| Previous-notes dropdown | built | `PreviousNotesDropdown` → `GET /workouts/previous-notes` (`ActiveWorkout.jsx:1591`, used at `:2806`) |
| Drag/drop reorder, desktop | built (builders) / partial (active workout) | `SortableList.jsx` (dnd-kit Mouse/Touch/Keyboard sensors) is used in `RoutineBuilder`, `ProgramBuilder` and `MeditationTimer`. The active workout uses ↑/↓ buttons only (`ActiveWorkout.jsx:3485-3486`) |
| Drag/drop reorder, mobile | built (builders) / missing (active workout) | `SortableList.jsx:64` TouchSensor with a 300 ms press. Same active-workout gap as above |
| Desktop tooltips | partial | `title=` attributes only (for example `SortableList.jsx:21`, `ActiveWorkout.jsx:1699`). No tooltip component |
| Meditation sessions logging to stats | built (own tab only) | `MeditationTimer.jsx:683-708` logs a `workouts` row with `workout_type='meditation'`. Shown only in the Stats > Meditation tab (`statsController.getMeditationStats`) and excluded from Overview by `workout_type <> 'meditation'` |
| Desktop nav timer during workout | built | `NavElapsedClock` (`App.jsx:36`, rendered at `:354`), toggled by `showNavClock` |
| Timer-type picker location | built: inside the per-exercise timer bar | Mode chooser in `WorkoutTimerBar`/`InlineTimer` (`ActiveWorkout.jsx:2812`, `:2878`). Block mode is opened from the workout header (`:2550`, `:3175`) |
| Tempo pre-timer countdown | missing / unclear | `TempoGuide.jsx` runs a phase countdown (`:28`) but no lead-in countdown before the first rep was found |
| Workout cancels when mobile app is backgrounded | not a server cancel; client loss | No backgrounding handlers. A discarded tab loses React state, and the server row stays with no `end_time` (see A1) |

### A3. Read paths

Before this run, `workouts.status` defaulted to `'completed'` on insert. Every `status = 'completed'` filter below therefore **already included in-progress and abandoned workouts**. Only an explicit Cancel set `'cancelled'`.

| Area | Function / query | Current filter |
|---|---|---|
| Stats overview: weekly frequency, time of day, day of week, durations, ratings, totals | `statsController.getOverview` | `status='completed' OR status IS NULL` (some also need `end_time`); meditation excluded |
| Stats strength summary, time series, flagged workouts | `statsController.getStrengthStats` | `status='completed'` |
| Stats cardio | `statsController.getCardioStats` (`cardio_sessions` + `workouts`) | `status='completed'` |
| Records / PRs | `statsController.getRecords` | `status='completed'` |
| Combined (feeds the Overview pies, **calendar**, the Combined tab and the **Stats > History tab**) | `statsController.getCombinedStats` | `status='completed'` |
| Exercise deep dive | `statsController.getExerciseStats` (3 queries) | `status='completed'` |
| Meditation tab | `statsController.getMeditationStats` | `status='completed'` |
| Workout list / history | `workoutController.getCombinedHistory` (`GET /workouts/history`, used by `WorkoutHistory.jsx`, which only Admin renders) | `status != 'cancelled'` |
| Workout list (API) | `workoutController.getWorkouts` (`GET /workouts`) | **none** |
| Workout detail | `workoutController.getWorkoutDetail` | none (correct: detail shows anything) |
| "Last time" / `last_performance`, routine start | `routineController.startWorkoutFromRoutine` last-workout query | **none**: an abandoned or cancelled session can be "last time" |
| "Last time" / `last_performance`, program start | `programController.startProgramWorkout` last-workout query | **none** |
| Overload suggestion | frontend `computeOverloadSuggestions` from `last_performance.sets_completed` (`ActiveWorkout.jsx:879-896`) | inherits the two rows above |
| Previous notes dropdown | `workoutController.getPreviousExerciseNotes` | `status='completed' AND end_time IS NOT NULL` |
| Previous notes in the Exercise Notes panel | `last_performance.exercise_notes` (`ActiveWorkout.jsx:3021`) | inherits `last_performance` |
| Calendar | `StatsCenter.WorkoutCalendar` → `/stats/combined` | as Combined |
| Streaks | none exist | `grep` finds no streak code in frontend or backend |
| Session counts | `routineController.getRoutines` `use_count`; `adminController.listUsers` `workout_count` | `status='completed'`; admin: **none** |
| Program next-up | `programController.getActivePrograms` `next_day` | `program_workouts` exists, **no workout status join** |
| Program completed counts | `getPrograms`, `getProgramById` (+ day `latest_pw`), `getActivePrograms` | `program_workouts` only |
| Program progress / achievement | `programController.getProgramProgress` (completed list + achievement %) | `program_workouts` only |
| Program stats silo | `programController.getProgramStats` (workouts + progression) | `program_workouts` only |

`program_workouts` rows are written in two places: `finishWorkout` (`workoutController.js:637-645`) and `POST /programs/:id/days/:prid/complete` (`completeProgramWorkout`, which takes any `workout_id`). Neither is created at start.

### A4. Cancel today

- `PUT /workouts/:id/cancel` sets `status='cancelled'` **and `end_time = now`**. It deletes nothing (`workoutController.js:654-673`). The frontend drops local state whether or not the call succeeds (`ActiveWorkout.jsx:905-919`).
- Program next-up does **not** count a cancelled workout, because cancel never writes `program_workouts`. But an abandoned workout (never finished or cancelled) is also not counted. And anything recorded through `/complete`, or a workout that was "finished" with nothing logged, **is** counted, whatever its status.
- `getCombinedHistory` hides cancelled workouts. The stats queries hide them. `last_performance` does **not** hide them.

### T2 seed result (migration 030 on seeded data)

| Seed row | Shape | Expected | Got |
|---|---|---|---|
| W1 | end time + 3 sets | completed | completed |
| W2 | no end, started 2 h ago, no sets | in_progress | in_progress |
| W3 | no end, started 36 h ago, 1 set | cancelled | cancelled |
| W4 | end time, no activity | cancelled | cancelled |
| W5 | end time, cardio segment only | completed | completed |
| W6 | meditation, `duration_seconds=600` | completed | completed |
| W7 | meditation, no `duration_seconds`, 2 s span (pre-027 style) | completed | completed |
| W8 | explicitly cancelled, end time + sets | cancelled (see Decisions) | cancelled |
| W9 | program workout, completed | completed | completed |
| W10 | program workout, abandoned 8 days ago, has a `program_workouts` row | cancelled | cancelled |
| W11 | 2026-11-20 03:30 UTC, `workout_date` 2026-11-19 | completed | completed |
| W12 to W16 | 11/02 rows (for the cleanup script) | per rule | as expected |
| W17 | other user, completed | completed | completed |

Counts: completed 10, cancelled 6, in_progress 1.

## Decisions made

1. **Explicitly cancelled rows stay cancelled.** The doc's rule would turn a workout the user cancelled, which has an end time (old cancel set `end_time`) and sets, into `completed`, and so into stats. That contradicts "cancelled never count in stats", so the backfill keeps `status='cancelled'` as is. `report-status-backfill.js` will count these rows separately.
2. **Meditation "recorded duration"** = `COALESCE(duration_seconds, end_time - start_time) > 0`. Rows logged before migration 027 have no `duration_seconds` but do have a few-second span, and they are real sessions.
3. **`status SET NOT NULL`** in addition to dropping the default. With no default and a nullable column, a missing status would silently be NULL rather than "fail loudly".
4. **FKs are `NOT VALID` and `ON DELETE SET NULL`.** `NOT VALID` means an orphan id already in production can't fail the deploy. `SET NULL` keeps workout history when a program is deleted.
5. **24 h comparisons use `start_time AT TIME ZONE 'UTC'`**, because the columns are `timestamp without time zone` holding UTC.
6. `results.md` goes in the project root as this doc specifies, not in the Obsidian folder that earlier briefs used.

## Notes for run 0A-2

(Filled in at the end of the run. Short version: all active-workout state is React-only in `App.jsx`; pause never reaches the server; there is no fetch-active-workout endpoint.)
