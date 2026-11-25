-- Phase 0A-2: session history and recovery.
--
-- Additive only, so the code deployed before this run keeps working:
-- one new table, two new users columns with defaults, guarded constraints.
-- Every statement is safe to run twice.

-- 1. Session events: one row per lifecycle step of a workout.
CREATE TABLE IF NOT EXISTS workout_session_events (
  id          SERIAL PRIMARY KEY,
  workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workout_session_events_type_allowed'
      AND conrelid = 'workout_session_events'::regclass
  ) THEN
    ALTER TABLE workout_session_events
      ADD CONSTRAINT workout_session_events_type_allowed
      CHECK (event_type IN ('started', 'paused', 'resumed', 'cancelled',
                            'auto_cancelled', 'reopened', 'finished'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workout_session_events_workout
  ON workout_session_events (workout_id, occurred_at);

-- 2. Backfill from data that exists. start_time / end_time are
-- `timestamp without time zone` holding UTC. Cancel and pause times are
-- unknown, so no such events are invented.
INSERT INTO workout_session_events (workout_id, event_type, occurred_at, metadata)
SELECT w.id, 'started', w.start_time AT TIME ZONE 'UTC', '{"backfilled": true}'::jsonb
FROM workouts w
WHERE w.start_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workout_session_events e
    WHERE e.workout_id = w.id AND e.event_type = 'started'
  );

INSERT INTO workout_session_events (workout_id, event_type, occurred_at, metadata)
SELECT w.id, 'finished', w.end_time AT TIME ZONE 'UTC', '{"backfilled": true}'::jsonb
FROM workouts w
WHERE w.status = 'completed'
  AND w.end_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workout_session_events e
    WHERE e.workout_id = w.id AND e.event_type = 'finished'
  );

-- 3. Per-account settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS workout_age_limit_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pause_note_minutes INTEGER NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_workout_age_limit_hours_allowed'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_workout_age_limit_hours_allowed
      CHECK (workout_age_limit_hours IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36, 48));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_pause_note_minutes_allowed'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_pause_note_minutes_allowed
      CHECK (pause_note_minutes IN (5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60));
  END IF;
END $$;
