-- Migration 018: Routine muscle tags, scheduled workouts, programs foundation

-- Primary/secondary muscle group tags on routines
ALTER TABLE workout_routines ADD COLUMN IF NOT EXISTS primary_muscles  TEXT[] DEFAULT '{}';
ALTER TABLE workout_routines ADD COLUMN IF NOT EXISTS secondary_muscles TEXT[] DEFAULT '{}';
ALTER TABLE workout_routines ADD COLUMN IF NOT EXISTS tags             TEXT[] DEFAULT '{}'; -- e.g. 'full body', 'push', 'pull', 'legs'

-- Programs: named collections of routines with a schedule pattern
CREATE TABLE IF NOT EXISTS programs (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_active       BOOLEAN DEFAULT FALSE,  -- only one program active at a time per user
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Routines within a program, with their assigned day slot
CREATE TABLE IF NOT EXISTS program_routines (
  id              SERIAL PRIMARY KEY,
  program_id      INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  routine_id      INTEGER NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE,
  day_slot        INTEGER NOT NULL,   -- 1-based position in the program cycle (e.g. day 1 = push, day 2 = pull)
  notes           TEXT,               -- e.g. "rest day", "optional cardio"
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled workouts: both one-off and recurring
CREATE TABLE IF NOT EXISTS scheduled_workouts (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id      INTEGER REFERENCES workout_routines(id) ON DELETE SET NULL,
  program_id      INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  scheduled_date  DATE NOT NULL,
  recurrence_type TEXT,               -- NULL (one-off), 'daily', 'weekly', 'every_x_days', 'x_per_week'
  recurrence_value INTEGER,           -- x in 'every_x_days' or 'x_per_week'
  recurrence_days INTEGER[],          -- day-of-week array for 'weekly' (0=Sun, 6=Sat)
  recurrence_end  DATE,               -- when recurrence stops (NULL = indefinite)
  completed       BOOLEAN DEFAULT FALSE,
  workout_id      INTEGER REFERENCES workouts(id) ON DELETE SET NULL,  -- linked when completed
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_user_date
  ON scheduled_workouts(user_id, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_program_routines_program
  ON program_routines(program_id, day_slot);

CREATE INDEX IF NOT EXISTS idx_programs_user
  ON programs(user_id);
  