-- Migration 016: Pace unit preferences + workout cardio segments table

-- User pace preferences (lives alongside units_distance)
ALTER TABLE users ADD COLUMN IF NOT EXISTS units_pace TEXT DEFAULT 'min/mile';
ALTER TABLE users ADD COLUMN IF NOT EXISTS units_split_distance INTEGER DEFAULT 500;

-- Cardio segments logged within strength workouts
-- One row per logged segment/round/lap for a cardio exercise in a workout
CREATE TABLE IF NOT EXISTS workout_cardio_segments (
  id                  SERIAL PRIMARY KEY,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  workout_id          INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  segment_number      INTEGER NOT NULL,             -- order within the exercise session
  segment_label       TEXT,                         -- 'Segment', 'Round', 'Lap' — set by subcategory
  duration_seconds    INTEGER,
  distance            NUMERIC(10,3),
  distance_unit       TEXT,                         -- inherits from user pref but overridable
  pace                NUMERIC(10,4),                -- stored as decimal minutes per unit (e.g. 8.5 = 8:30/mile)
  pace_unit           TEXT,                         -- 'min/mile','min/km','mph','split/500m','split/Xm'
  pace_overridden     BOOLEAN DEFAULT FALSE,        -- true if user manually changed the derived value
  reps                INTEGER,                      -- for interval types (rounds, suicides, etc.)
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cardio_segments_workout_exercise
  ON workout_cardio_segments(workout_exercise_id);

CREATE INDEX IF NOT EXISTS idx_cardio_segments_workout
  ON workout_cardio_segments(workout_id);
  