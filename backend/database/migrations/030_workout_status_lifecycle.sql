-- Migration 030: Workout status lifecycle, shell-change catch-up, user time zone
-- (Phase 0A-1). Idempotent: safe on a fresh database and on production, where
-- some of these columns were added by hand in the Northflank shell.
--
-- Timestamps note: workouts.start_time / end_time are `timestamp without time
-- zone` holding UTC wall-clock values (the backend writes toISOString() or
-- NOW() on a UTC server). Comparisons against NOW() therefore go through
-- `AT TIME ZONE 'UTC'` so they don't depend on the session TimeZone setting.

-- ── 1. Catch-up for shell-change columns on workouts ─────────────────────────
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS program_id integer;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS program_routine_id integer;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS total_paused_seconds integer DEFAULT 0;
ALTER TABLE workouts ALTER COLUMN total_paused_seconds SET DEFAULT 0;

-- Foreign keys only when the column has none yet. NOT VALID so a stray orphan
-- id already sitting in production can't fail the deploy; new writes are
-- still checked. ON DELETE SET NULL keeps workout history when a program or
-- program day is deleted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'workouts'::regclass AND c.contype = 'f' AND a.attname = 'program_id'
  ) THEN
    ALTER TABLE workouts
      ADD CONSTRAINT workouts_program_id_fkey
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'workouts'::regclass AND c.contype = 'f' AND a.attname = 'program_routine_id'
  ) THEN
    ALTER TABLE workouts
      ADD CONSTRAINT workouts_program_routine_id_fkey
      FOREIGN KEY (program_routine_id) REFERENCES program_routines(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ── 2. Status backfill ───────────────────────────────────────────────────────
-- Activity = at least one logged set, OR at least one cardio segment, OR a
-- meditation session with a recorded duration (explicit duration_seconds, or
-- for older rows that predate it, a positive start→end span).
--
-- Rows already explicitly 'cancelled' (the user pressed Cancel) stay
-- cancelled. Otherwise:
--   completed   : end_time set AND activity
--   in_progress : no end_time AND started within the last 24 hours
--   cancelled   : everything else
-- Only `status` changes; no rows or logged data are removed.
UPDATE workouts w
SET status = CASE
  WHEN w.status = 'cancelled' THEN 'cancelled'
  WHEN w.end_time IS NOT NULL AND (
         EXISTS (SELECT 1 FROM workout_exercises we
                 JOIN workout_sets ws ON ws.workout_exercise_id = we.id
                 WHERE we.workout_id = w.id)
      OR EXISTS (SELECT 1 FROM workout_cardio_segments wcs WHERE wcs.workout_id = w.id)
      OR (w.workout_type = 'meditation'
          AND COALESCE(w.duration_seconds, EXTRACT(EPOCH FROM (w.end_time - w.start_time))) > 0)
    ) THEN 'completed'
  WHEN w.end_time IS NULL
       AND w.start_time IS NOT NULL
       AND (w.start_time AT TIME ZONE 'UTC') >= NOW() - INTERVAL '24 hours'
    THEN 'in_progress'
  ELSE 'cancelled'
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workouts'::regclass AND conname = 'workouts_status_allowed'
  ) THEN
    ALTER TABLE workouts
      ADD CONSTRAINT workouts_status_allowed
      CHECK (status IN ('in_progress', 'completed', 'cancelled'));
  END IF;
END $$;

-- Every insert path now sets status explicitly (Phase 0A-1 section 04), so the
-- old 'completed' default goes: a missing status must fail loudly.
ALTER TABLE workouts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE workouts ALTER COLUMN status SET NOT NULL;

-- ── 3. User time zone ────────────────────────────────────────────────────────
-- IANA name (e.g. America/New_York), sent by the browser. NULL means UTC.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;
