-- Migration 014: Workout, Cardio, and Superset Enhancements

-- routine_exercises: cooldown, training type, superset ordering
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER DEFAULT 60;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS training_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS training_duration INTEGER;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS superset_order INTEGER;

-- workouts: custom title for Free Lift and future use
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS workout_title TEXT;

-- cardio_sessions: elevation loss was missing
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS elevation_loss NUMERIC;

-- cardio_checkpoints: named mid-session segments (halfway, legs, aid stations, etc.)
CREATE TABLE IF NOT EXISTS cardio_checkpoints (
  id                  SERIAL PRIMARY KEY,
  cardio_session_id   INTEGER NOT NULL REFERENCES cardio_sessions(id) ON DELETE CASCADE,
  checkpoint_name     TEXT NOT NULL,
  checkpoint_order    INTEGER NOT NULL,
  recorded_at         TIMESTAMPTZ DEFAULT NOW(),
  distance            NUMERIC(10,2),
  avg_speed           NUMERIC(6,2),
  max_speed           NUMERIC(6,2),
  odometer            NUMERIC(10,2),
  avg_heart_rate      INTEGER,
  max_heart_rate      INTEGER,
  est_calories        INTEGER,
  elevation_gain      NUMERIC(8,2),
  elevation_loss      NUMERIC(8,2),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cardio_checkpoints_session
  ON cardio_checkpoints(cardio_session_id);

CREATE INDEX IF NOT EXISTS idx_cardio_checkpoints_order
  ON cardio_checkpoints(cardio_session_id, checkpoint_order);

  