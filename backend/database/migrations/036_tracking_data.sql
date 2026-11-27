-- Migration 036 (Phase 1A-2): tracking data.
--
-- Additive only: new tables, and new nullable columns or columns with
-- defaults. Nothing is dropped or renamed, and no existing row changes value
-- (soft delete and the edited marker are new NULL columns). The 1A-1 code keeps
-- working against it. Safe to re-run.
--
--  1. Habits, habit logs, program goals.
--  2. Injuries (trainer-suggestion columns ready for 1C-1).
--  3. Note tags (rules-based tags on workout, exercise, set and segment notes).
--  4. Workouts: vibes and fuel ratings, readiness check-in; settings for the
--     check-in default (user) and overrides (program, routine).
--  5. Daily check-in items and entries.
--  6. Review snapshots (cached daily / weekly summaries).
--  7. Edit audit trail and soft delete (workouts, sets, cardio segments).
--  8. Device-ready fields on cardio sessions and segments, and a samples table.
--  9. Saved cardio routes.

-- ── 1. Habits and goals ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habits (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  target_value  NUMERIC(10,2),
  unit          TEXT,
  frequency     TEXT NOT NULL DEFAULT 'daily',     -- daily | weekly | specific_days
  days_of_week  INTEGER[],                         -- specific_days: 0 = Mon … 6 = Sun
  program_id    INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  routine_id    INTEGER REFERENCES workout_routines(id) ON DELETE SET NULL,
  cardio_type   TEXT,
  auto_metric   TEXT,                              -- NULL = logged by hand
  goal_link     TEXT,                              -- starter habits: the settings goal they follow
  starter_key   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT habits_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT habits_frequency_allowed CHECK (frequency IN ('daily', 'weekly', 'specific_days')),
  CONSTRAINT habits_auto_metric_allowed CHECK (auto_metric IS NULL OR auto_metric IN
    ('workouts_completed', 'workout_minutes', 'cardio_minutes', 'cardio_distance')),
  CONSTRAINT habits_target_nonneg CHECK (target_value IS NULL OR target_value >= 0)
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_habits_user_starter ON habits (user_id, starter_key) WHERE starter_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS habit_logs (
  id          SERIAL PRIMARY KEY,
  habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  value       NUMERIC(10,2) NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT habit_logs_value_nonneg CHECK (value >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_habit_logs_day ON habit_logs (habit_id, log_date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs (user_id, log_date);

CREATE TABLE IF NOT EXISTS program_goals (
  id               SERIAL PRIMARY KEY,
  program_id       INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  metric           TEXT,
  target_value     NUMERIC(10,2),
  threshold_value  NUMERIC(10,2),
  unit             TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT program_goals_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_program_goals_program ON program_goals (program_id);

-- ── 2. Injuries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS injuries (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_area             TEXT NOT NULL,
  side                  TEXT,
  start_date            DATE NOT NULL,
  end_date              DATE,
  status                TEXT NOT NULL DEFAULT 'active',
  notes                 TEXT,
  limit_flag            TEXT,
  limit_note            TEXT,
  source                TEXT NOT NULL DEFAULT 'self',
  suggested_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  suggestion_status     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT injuries_side_allowed CHECK (side IS NULL OR side IN ('left', 'right', 'both')),
  CONSTRAINT injuries_status_allowed CHECK (status IN ('active', 'recovering', 'resolved')),
  CONSTRAINT injuries_limit_flag_allowed CHECK (limit_flag IS NULL OR limit_flag IN ('preference', 'medical')),
  CONSTRAINT injuries_source_allowed CHECK (source IN ('self', 'trainer')),
  CONSTRAINT injuries_suggestion_status_allowed CHECK (suggestion_status IS NULL OR suggestion_status IN ('pending', 'accepted', 'dismissed')),
  CONSTRAINT injuries_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_injuries_user ON injuries (user_id, status);

-- ── 3. Note tags ─────────────────────────────────────────────────────────────
-- source_type: workout_overall | workout_session | exercise | segment.
-- Exercise notes hold one line per note ("Set 2: ..." or "General: ..."), so a
-- tag records the line and, for a set note, the set number.
CREATE TABLE IF NOT EXISTS note_tags (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id       INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL,
  source_id        INTEGER NOT NULL,
  line_number      INTEGER NOT NULL DEFAULT 0,
  set_number       INTEGER,
  tag              TEXT NOT NULL,
  matched_keyword  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT note_tags_source_type_allowed CHECK (source_type IN ('workout_overall', 'workout_session', 'exercise', 'segment'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_tags_entry ON note_tags (source_type, source_id, line_number, tag);
CREATE INDEX IF NOT EXISTS idx_note_tags_user_tag ON note_tags (user_id, tag);
CREATE INDEX IF NOT EXISTS idx_note_tags_workout ON note_tags (workout_id);

-- ── 4. Ratings and readiness ─────────────────────────────────────────────────
-- session_rating stays the Effort rating (owner, 1A-2). Vibes uses the same
-- range (1-10, shown on the user's 5- or 10-point scale). Fuel is 1-5.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS vibes_rating SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS fuel_rating SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS readiness_sleep SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS readiness_soreness SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS readiness_energy SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS readiness_recorded_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS readiness_checkin_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS readiness_checkin BOOLEAN;            -- NULL = follow the user setting
ALTER TABLE workout_routines ADD COLUMN IF NOT EXISTS readiness_checkin BOOLEAN;    -- NULL = follow program / user

-- ── 5. Daily check-in ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_items (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_key   TEXT,                       -- sleep | soreness | energy | mood; NULL = user-defined
  label        TEXT NOT NULL,
  scale_min    SMALLINT NOT NULL DEFAULT 1,
  scale_max    SMALLINT NOT NULL DEFAULT 5,
  habit_id     INTEGER REFERENCES habits(id) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  order_index  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT checkin_items_label_not_blank CHECK (length(btrim(label)) > 0),
  CONSTRAINT checkin_items_scale_ordered CHECK (scale_min < scale_max)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_items_preset ON checkin_items (user_id, preset_key) WHERE preset_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkin_entries (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES checkin_items(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL,
  value       SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_entries_day ON checkin_entries (item_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_checkin_entries_user_date ON checkin_entries (user_id, entry_date);

-- ── 6. Review snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_snapshots (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type   TEXT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  data          JSONB NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT review_snapshots_period_allowed CHECK (period_type IN ('day', 'week'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_snapshots_period ON review_snapshots (user_id, period_type, period_start);

-- ── 7. Edit audit trail and soft delete ──────────────────────────────────────
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

-- One row per edit, delete or restore. `changes` = { column: { "from": old, "to": new } }.
CREATE TABLE IF NOT EXISTS record_edits (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_type  TEXT NOT NULL,
  record_id    INTEGER NOT NULL,
  workout_id   INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  changes      JSONB,
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT record_edits_type_allowed CHECK (record_type IN ('workout', 'set', 'segment')),
  CONSTRAINT record_edits_action_allowed CHECK (action IN ('edit', 'delete', 'restore'))
);
CREATE INDEX IF NOT EXISTS idx_record_edits_record ON record_edits (record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_record_edits_workout ON record_edits (workout_id);

CREATE INDEX IF NOT EXISTS idx_workouts_deleted ON workouts (user_id) WHERE deleted_at IS NOT NULL;

-- ── 8. Device-ready fields ───────────────────────────────────────────────────
-- cardio_sessions already has avg/max heart rate, zones 1-5, elevation gain and
-- loss, and calories_burned (009/014); only the missing ones are added.
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS min_heart_rate INTEGER;
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS elevation_max NUMERIC(8,2);
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS route_data JSONB;
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS avg_cadence INTEGER;
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS max_cadence INTEGER;
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS source_device TEXT;
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS avg_heart_rate INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS max_heart_rate INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS min_heart_rate INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS hr_zone_1_seconds INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS hr_zone_2_seconds INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS hr_zone_3_seconds INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS hr_zone_4_seconds INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS hr_zone_5_seconds INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS elevation_gain NUMERIC(8,2);
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS elevation_loss NUMERIC(8,2);
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS elevation_max NUMERIC(8,2);
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS route_data JSONB;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS avg_cadence INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS max_cadence INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS calories_burned INTEGER;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS source_device TEXT;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Time series for later device or file imports (storage only).
CREATE TABLE IF NOT EXISTS cardio_samples (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type      TEXT NOT NULL,           -- cardio_session | segment
  owner_id        INTEGER NOT NULL,
  offset_seconds  NUMERIC(10,2) NOT NULL,
  heart_rate      INTEGER,
  elevation       NUMERIC(8,2),
  latitude        NUMERIC(9,6),
  longitude       NUMERIC(9,6),
  cadence         INTEGER,
  speed           NUMERIC(8,3),
  distance        NUMERIC(10,3),
  power           INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cardio_samples_owner_type_allowed CHECK (owner_type IN ('cardio_session', 'segment')),
  CONSTRAINT cardio_samples_offset_nonneg CHECK (offset_seconds >= 0)
);
CREATE INDEX IF NOT EXISTS idx_cardio_samples_owner ON cardio_samples (owner_type, owner_id, offset_seconds);

-- ── 9. Saved cardio routes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_routes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  route_data     JSONB,
  distance       NUMERIC(10,3),
  distance_unit  TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT saved_routes_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT saved_routes_distance_nonneg CHECK (distance IS NULL OR distance >= 0)
);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes (user_id);
ALTER TABLE cardio_sessions ADD COLUMN IF NOT EXISTS saved_route_id INTEGER REFERENCES saved_routes(id) ON DELETE SET NULL;
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS saved_route_id INTEGER REFERENCES saved_routes(id) ON DELETE SET NULL;

-- ── Constraints on new columns of existing tables (guarded by name) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workouts_vibes_rating_range') THEN
    ALTER TABLE workouts ADD CONSTRAINT workouts_vibes_rating_range CHECK (vibes_rating IS NULL OR vibes_rating BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workouts_fuel_rating_range') THEN
    ALTER TABLE workouts ADD CONSTRAINT workouts_fuel_rating_range CHECK (fuel_rating IS NULL OR fuel_rating BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workouts_readiness_range') THEN
    ALTER TABLE workouts ADD CONSTRAINT workouts_readiness_range CHECK (
      (readiness_sleep IS NULL OR readiness_sleep BETWEEN 1 AND 5)
      AND (readiness_soreness IS NULL OR readiness_soreness BETWEEN 1 AND 5)
      AND (readiness_energy IS NULL OR readiness_energy BETWEEN 1 AND 5));
  END IF;
END $$;
