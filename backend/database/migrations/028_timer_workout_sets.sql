-- Migration 028: Let timer modes write workout_sets rows.
--
-- 1. reps_completed: CHECK (> 0) becomes (>= 0). A Tabata interval where the
--    user entered no count is recorded as 0 reps rather than rejected.
-- 2. set_type: adds 'emom', 'tabata', 'amrap', 'interval' to the allowed
--    values so timer-logged sets stay distinguishable from normal sets.
--
-- The original constraints were declared inline in 001 and got generated
-- names, so they're located by definition rather than by assumed name. Safe to
-- re-run: the old definitions won't match a second time, and the new
-- constraints are dropped and recreated by name.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'workout_sets'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%reps_completed > 0%'
        OR (pg_get_constraintdef(oid) ILIKE '%set_type%' AND conname <> 'workout_sets_set_type_allowed')
      )
  LOOP
    EXECUTE format('ALTER TABLE workout_sets DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_reps_nonnegative;
ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_reps_nonnegative CHECK (reps_completed >= 0);

ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_set_type_allowed;
ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_set_type_allowed
  CHECK (set_type IN ('normal', 'warmup', 'drop', 'superset', 'emom', 'tabata', 'amrap', 'interval'));
