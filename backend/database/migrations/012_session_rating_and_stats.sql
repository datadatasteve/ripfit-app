-- Migration 012: Session rating, workout rating preferences, stats indexes

-- Session rating on strength workouts
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS session_rating   SMALLINT CHECK (session_rating BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS session_notes    TEXT;

-- Session rating on cardio sessions
ALTER TABLE cardio_sessions
  ADD COLUMN IF NOT EXISTS session_rating   SMALLINT CHECK (session_rating BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS session_notes    TEXT;

-- User preferences for the rating widget
-- Stored as JSONB so we can extend without more migrations.
-- Default shape: { label: "Effort & Vibes", scale: 5, display: "slider" }
-- display options: "slider" | "stars" | "number" | "emoji"
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workout_rating_prefs JSONB NOT NULL DEFAULT
    '{"label":"Effort & Vibes","scale":5,"display":"slider"}';

-- Performance indexes for stats queries
CREATE INDEX IF NOT EXISTS idx_workouts_user_date
  ON workouts(user_id, workout_date DESC);

CREATE INDEX IF NOT EXISTS idx_workouts_start_time
  ON workouts(user_id, start_time);

CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise
  ON workout_sets(workout_exercise_id);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout
  ON workout_exercises(workout_id, exercise_id);

CREATE INDEX IF NOT EXISTS idx_cardio_user_date
  ON cardio_sessions(user_id, session_date DESC);
  