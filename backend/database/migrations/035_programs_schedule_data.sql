-- Migration 035 (Phase 1A-1): programs and schedule data.
--
-- Additive only. Nothing is dropped or renamed, and no existing row changes
-- value. Every new column on an existing table is nullable or has a default,
-- and every new schedule capability is opt-in, so the 0B-2 code keeps working
-- against it. Safe to re-run (IF NOT EXISTS everywhere, constraints guarded by
-- name).
--
--  0. program_routines.day_slot / routine_id: NOT NULL relaxed (production
--     already has them nullable; the app has always written NULL routine_id
--     for rest days and never writes day_slot).
--  1. Exercise aliases (global + per user) and per-user default names.
--  2. programs: schedule mode, x-per-week, pin, color, overview.
--  3. program_routines: day type, title, one-off date, time of day, special tag.
--  4. Program phases, day skips, pauses, legend, sources.
--  5. Calendar feed tokens.
--  6. Circuit blocks (routine template or workout instance), movements, round logs.
--  7. RPE target (1-11) and micro overload fields.

-- ── 0. program_routines nullability ──────────────────────────────────────────
ALTER TABLE program_routines ALTER COLUMN day_slot DROP NOT NULL;
ALTER TABLE program_routines ALTER COLUMN routine_id DROP NOT NULL;

-- ── 1. Exercise aliases and default names ────────────────────────────────────
-- user_id NULL = a global alias (admin-curated); otherwise the user's own.
CREATE TABLE IF NOT EXISTS exercise_aliases (
  id                  SERIAL PRIMARY KEY,
  exercise_id         INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
  alias               TEXT NOT NULL,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT exercise_aliases_alias_not_blank CHECK (length(btrim(alias)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_aliases_global
  ON exercise_aliases (exercise_id, lower(alias)) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_aliases_user
  ON exercise_aliases (user_id, exercise_id, lower(alias)) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exercise_aliases_exercise ON exercise_aliases (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_aliases_user ON exercise_aliases (user_id);

-- The name a user wants to see for an exercise (one per user and exercise).
CREATE TABLE IF NOT EXISTS user_exercise_names (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id   INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, exercise_id),
  CONSTRAINT user_exercise_names_not_blank CHECK (length(btrim(display_name)) > 0)
);

-- ── 2. programs ──────────────────────────────────────────────────────────────
-- schedule_mode 'fixed' = today's behavior (days placed on week + weekday).
-- 'flexible' = "x workouts per week, any day": days carry a week but no weekday.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS workouts_per_week INTEGER;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS overview TEXT;

-- ── 3. program_routines (one row per scheduled item) ─────────────────────────
-- day_type NULL = the old meaning (is_rest_day decides workout or rest).
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS day_type TEXT;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS is_one_off BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS time_of_day TEXT;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS planned_time TIME;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS special_tag TEXT;
ALTER TABLE program_routines ADD COLUMN IF NOT EXISTS special_note TEXT;

-- ── 4. Phases, skips, pauses, legend, sources ────────────────────────────────
CREATE TABLE IF NOT EXISTS program_phases (
  id           SERIAL PRIMARY KEY,
  program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  start_day    INTEGER,            -- 1 = the program's first day; NULL = right after the previous phase
  length_days  INTEGER NOT NULL,
  notes        TEXT,
  order_index  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT program_phases_length_positive CHECK (length_days > 0),
  CONSTRAINT program_phases_start_positive CHECK (start_day IS NULL OR start_day > 0)
);
CREATE INDEX IF NOT EXISTS idx_program_phases_program ON program_phases (program_id, order_index);

-- A skipped day stays on the schedule; this row says it was skipped.
CREATE TABLE IF NOT EXISTS program_day_skips (
  id                  SERIAL PRIMARY KEY,
  program_id          INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  program_routine_id  INTEGER REFERENCES program_routines(id) ON DELETE SET NULL,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_date      DATE,
  reason              TEXT,
  skipped_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_day_skips_day
  ON program_day_skips (program_routine_id) WHERE program_routine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_program_day_skips_program ON program_day_skips (program_id);
CREATE INDEX IF NOT EXISTS idx_program_day_skips_user_date ON program_day_skips (user_id, scheduled_date);

-- Pause and delay: items dated on or after from_date move delay_days later.
CREATE TABLE IF NOT EXISTS program_pauses (
  id               SERIAL PRIMARY KEY,
  program_id       INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date        DATE NOT NULL,
  delay_days       INTEGER NOT NULL DEFAULT 0,
  reason           TEXT,
  previous_status  TEXT,
  paused_at        TIMESTAMPTZ DEFAULT NOW(),
  resumed_at       TIMESTAMPTZ,
  CONSTRAINT program_pauses_delay_range CHECK (delay_days BETWEEN 0 AND 365)
);
CREATE INDEX IF NOT EXISTS idx_program_pauses_program ON program_pauses (program_id, from_date);

CREATE TABLE IF NOT EXISTS program_legend_items (
  id           SERIAL PRIMARY KEY,
  program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  description  TEXT,
  order_index  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_program_legend_items_program ON program_legend_items (program_id, order_index);

CREATE TABLE IF NOT EXISTS program_sources (
  id           SERIAL PRIMARY KEY,
  program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  url          TEXT,
  note         TEXT,
  order_index  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_program_sources_program ON program_sources (program_id, order_index);

-- ── 5. Calendar feed (private .ics link) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  rotated_at  TIMESTAMPTZ
);

-- ── 6. Circuit blocks ────────────────────────────────────────────────────────
-- A circuit lives in a routine (template) or in a workout (instance), never
-- both. Every detail is nullable: a circuit added on the fly needs only a name
-- and a logging mode.
CREATE TABLE IF NOT EXISTS circuits (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id         INTEGER REFERENCES workout_routines(id) ON DELETE CASCADE,
  workout_id         INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
  source_circuit_id  INTEGER REFERENCES circuits(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  logging_mode       TEXT NOT NULL,
  rounds             INTEGER,
  work_seconds       INTEGER,
  rest_seconds       INTEGER,
  order_index        INTEGER,
  notes              TEXT,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT circuits_one_owner CHECK (num_nonnulls(routine_id, workout_id) = 1),
  CONSTRAINT circuits_logging_mode_allowed CHECK (logging_mode IN ('completion', 'full')),
  CONSTRAINT circuits_rounds_positive CHECK (rounds IS NULL OR rounds > 0),
  CONSTRAINT circuits_work_nonneg CHECK (work_seconds IS NULL OR work_seconds >= 0),
  CONSTRAINT circuits_rest_nonneg CHECK (rest_seconds IS NULL OR rest_seconds >= 0)
);
CREATE INDEX IF NOT EXISTS idx_circuits_routine ON circuits (routine_id) WHERE routine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_circuits_workout ON circuits (workout_id) WHERE workout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_circuits_user ON circuits (user_id);

CREATE TABLE IF NOT EXISTS circuit_movements (
  id                    SERIAL PRIMARY KEY,
  circuit_id            INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
  exercise_id           INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
  name                  TEXT,
  order_index           INTEGER NOT NULL DEFAULT 1,
  target_reps           INTEGER,
  target_weight         NUMERIC(7,2),
  target_seconds        INTEGER,
  target_distance       NUMERIC(10,3),
  target_distance_unit  TEXT,
  target_rpe            SMALLINT,
  notes                 TEXT,
  micro_overload        JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT circuit_movements_rpe_range CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 11),
  CONSTRAINT circuit_movements_targets_nonneg CHECK (
    (target_reps IS NULL OR target_reps >= 0) AND (target_weight IS NULL OR target_weight >= 0)
    AND (target_seconds IS NULL OR target_seconds >= 0) AND (target_distance IS NULL OR target_distance >= 0))
);
CREATE INDEX IF NOT EXISTS idx_circuit_movements_circuit ON circuit_movements (circuit_id, order_index);

-- One row per round (completion mode: movement_id NULL) or per movement per
-- round (full mode, with reps and weight).
CREATE TABLE IF NOT EXISTS circuit_round_logs (
  id                SERIAL PRIMARY KEY,
  circuit_id        INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
  movement_id       INTEGER REFERENCES circuit_movements(id) ON DELETE CASCADE,
  round_number      INTEGER NOT NULL,
  completed         BOOLEAN NOT NULL DEFAULT TRUE,
  reps              INTEGER,
  weight            NUMERIC(7,2),
  duration_seconds  INTEGER,
  distance          NUMERIC(10,3),
  rpe               SMALLINT,
  logged_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT circuit_round_logs_round_positive CHECK (round_number > 0),
  CONSTRAINT circuit_round_logs_values_nonneg CHECK (
    (reps IS NULL OR reps >= 0) AND (weight IS NULL OR weight >= 0)
    AND (duration_seconds IS NULL OR duration_seconds >= 0) AND (distance IS NULL OR distance >= 0)),
  CONSTRAINT circuit_round_logs_rpe_range CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 11)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_circuit_round_logs_entry
  ON circuit_round_logs (circuit_id, round_number, COALESCE(movement_id, 0));

-- ── 7. RPE target and micro overload ─────────────────────────────────────────
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_rpe SMALLINT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS micro_overload JSONB;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS target_rpe SMALLINT;

-- ── Constraints on new columns of existing tables (guarded by name) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_schedule_mode_allowed') THEN
    ALTER TABLE programs ADD CONSTRAINT programs_schedule_mode_allowed
      CHECK (schedule_mode IN ('fixed', 'flexible'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_workouts_per_week_range') THEN
    ALTER TABLE programs ADD CONSTRAINT programs_workouts_per_week_range
      CHECK (workouts_per_week IS NULL OR workouts_per_week BETWEEN 1 AND 14);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_color_hex') THEN
    ALTER TABLE programs ADD CONSTRAINT programs_color_hex
      CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_routines_day_type_allowed') THEN
    ALTER TABLE program_routines ADD CONSTRAINT program_routines_day_type_allowed
      CHECK (day_type IS NULL OR day_type IN ('workout', 'rest_day', 'single_event', 'open_day'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_routines_time_of_day_allowed') THEN
    ALTER TABLE program_routines ADD CONSTRAINT program_routines_time_of_day_allowed
      CHECK (time_of_day IS NULL OR time_of_day IN ('morning', 'afternoon', 'evening'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_routines_special_tag_allowed') THEN
    ALTER TABLE program_routines ADD CONSTRAINT program_routines_special_tag_allowed
      CHECK (special_tag IS NULL OR special_tag IN ('pr_day', 'trial', 'evaluation', 'milestone'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routine_exercises_target_rpe_range') THEN
    ALTER TABLE routine_exercises ADD CONSTRAINT routine_exercises_target_rpe_range
      CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 11);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_target_rpe_range') THEN
    ALTER TABLE workout_exercises ADD CONSTRAINT workout_exercises_target_rpe_range
      CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 11);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_program_routines_scheduled_date
  ON program_routines (scheduled_date) WHERE scheduled_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_programs_user_pinned ON programs (user_id) WHERE is_pinned;
