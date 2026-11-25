-- Migration 034 (Phase 0B-1b): RPE up to 11, and two tempo click track preferences.
--
-- Additive only: the 0B-1 code keeps working against it (the RPE range only
-- widens, and the new columns have defaults). Safe to re-run.
--
-- 1. workout_sets.rpe: 1 to 11 (was 1 to 10, from the inline CHECK in 001,
--    which Postgres named workout_sets_rpe_check). It is the only RPE column.
-- 2. users.tempo_click_track_enabled: the Tempo track button on exercises that
--    have a tempo (default on).
-- 3. users.tempo_track_with_timers: start the tempo click track together with
--    the Timers panel's Start (default off).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workout_sets_rpe_check'
      AND conrelid = 'workout_sets'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%11%'
  ) THEN
    ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_rpe_check;
    ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_rpe_check
      CHECK (rpe >= 1 AND rpe <= 11);
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tempo_click_track_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tempo_track_with_timers BOOLEAN NOT NULL DEFAULT FALSE;
