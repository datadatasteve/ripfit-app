-- Phase 0B-1
-- 1. program_workouts: one row per workout. Duplicates (the same workout
--    recorded more than once, e.g. finish plus /complete) are removed, keeping
--    the lowest id, then a unique index stops new ones. Rows without a
--    workout_id are left alone (the index ignores them).
-- 2. Two user preferences: Log Set button position and tempo lead-in beeps.
-- Additive for the code deployed today: its inserts use WHERE NOT EXISTS or
-- ON CONFLICT DO NOTHING, and the new columns have defaults.

DELETE FROM program_workouts pw
USING program_workouts keep
WHERE pw.workout_id IS NOT NULL
  AND keep.workout_id = pw.workout_id
  AND keep.id < pw.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_workouts_workout
  ON program_workouts (workout_id)
  WHERE workout_id IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS log_set_button_position TEXT NOT NULL DEFAULT 'inline';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tempo_countdown_beeps INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_log_set_button_position_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_log_set_button_position_allowed
      CHECK (log_set_button_position IN ('inline', 'pinned'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tempo_countdown_beeps_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_tempo_countdown_beeps_allowed
      CHECK (tempo_countdown_beeps BETWEEN 0 AND 5);
  END IF;
END $$;
