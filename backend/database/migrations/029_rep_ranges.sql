-- Migration 029: Rep ranges (Patch 001).
--
-- target_reps becomes target_reps_min / target_reps_max on both the routine
-- template (routine_exercises) and the per-workout snapshot (workout_exercises,
-- added in 008). Existing single targets copy into both columns, so "12"
-- becomes 12–12 and still displays as "12".
--
-- Guarded so a re-run after target_reps is gone is a no-op rather than an error.

ALTER TABLE routine_exercises
  ADD COLUMN IF NOT EXISTS target_reps_min integer,
  ADD COLUMN IF NOT EXISTS target_reps_max integer;

ALTER TABLE workout_exercises
  ADD COLUMN IF NOT EXISTS target_reps_min integer,
  ADD COLUMN IF NOT EXISTS target_reps_max integer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'routine_exercises' AND column_name = 'target_reps') THEN
    UPDATE routine_exercises
      SET target_reps_min = target_reps,
          target_reps_max = target_reps
      WHERE target_reps IS NOT NULL;
    ALTER TABLE routine_exercises DROP COLUMN target_reps;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'workout_exercises' AND column_name = 'target_reps') THEN
    UPDATE workout_exercises
      SET target_reps_min = target_reps,
          target_reps_max = target_reps
      WHERE target_reps IS NOT NULL;
    ALTER TABLE workout_exercises DROP COLUMN target_reps;
  END IF;
END $$;
