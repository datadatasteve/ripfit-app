-- Migration 008: Add target sets/reps/weight to workout_exercises
-- Needed so exercises added ad-hoc (e.g. from Exercise Browser mid-workout)
-- can carry their own goals, same as routine-templated exercises.

ALTER TABLE workout_exercises
  ADD COLUMN IF NOT EXISTS target_sets INTEGER,
  ADD COLUMN IF NOT EXISTS target_reps INTEGER,
  ADD COLUMN IF NOT EXISTS target_weight NUMERIC;