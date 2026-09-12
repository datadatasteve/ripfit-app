-- Migration 021: Exercise media/instructions columns + user-submitted exercise reports

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS video_url_male   VARCHAR,
  ADD COLUMN IF NOT EXISTS video_url_female VARCHAR,
  ADD COLUMN IF NOT EXISTS instructions     TEXT[];

-- Any logged-in user can flag an exercise (wrong muscles, bad description,
-- duplicate). Admins resolve them from the Exercise Manager.
CREATE TABLE IF NOT EXISTS exercise_reports (
  id          SERIAL PRIMARY KEY,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  report_text TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  resolved    BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_exercise_reports_unresolved
  ON exercise_reports (resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exercise_reports_exercise
  ON exercise_reports (exercise_id);
