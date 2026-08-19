-- Migration 020: Extend programs for full program feature

-- Extend programs table
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS duration_weeks INTEGER,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS schedule_shift_pref TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS synopsis TEXT;

-- Extend program_routines for week/day placement and rest days
ALTER TABLE program_routines
  ADD COLUMN IF NOT EXISTS week_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS day_of_week INTEGER,
  ADD COLUMN IF NOT EXISTS is_rest_day BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 1;

-- Track which completed workouts belong to which program slot
CREATE TABLE IF NOT EXISTS program_workouts (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
  program_routine_id INTEGER REFERENCES program_routines(id) ON DELETE SET NULL,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
  scheduled_date DATE,
  completed_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Program journal entries
CREATE TABLE IF NOT EXISTS program_journal_entries (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_program_workouts_program ON program_workouts(program_id);
CREATE INDEX IF NOT EXISTS idx_program_workouts_workout ON program_workouts(workout_id);
CREATE INDEX IF NOT EXISTS idx_program_journal_program ON program_journal_entries(program_id);
CREATE INDEX IF NOT EXISTS idx_program_routines_program ON program_routines(program_id);
