-- Migration 027: Columns required by Phase 2 features that the brief assumed existed.
--
-- exercises.source — marks user-typed exercises created by the timer-block flow
--   ('user_generated') apart from curated ones ('admin'). Existing rows default
--   to 'admin'.
-- workouts.duration_seconds — explicit session length. Meditation sessions are
--   logged after they finish, so start_time/end_time are seconds apart and can't
--   be used to derive duration. Nullable; other workout types keep deriving from
--   timestamps.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'admin';

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS duration_seconds integer
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
