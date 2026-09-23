-- Migration 025: Saved lifting-tempo templates per user.

CREATE TABLE IF NOT EXISTS tempo_templates (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name varchar NOT NULL,
  eccentric integer NOT NULL CHECK (eccentric >= 0),
  pause integer NOT NULL CHECK (pause >= 0),
  concentric integer NOT NULL CHECK (concentric >= 0),
  created_at timestamptz DEFAULT now()
);

-- Named with IF NOT EXISTS: an unnamed CREATE INDEX would add a duplicate
-- index every time this file was re-run by hand.
CREATE INDEX IF NOT EXISTS idx_tempo_templates_user ON tempo_templates(user_id);
