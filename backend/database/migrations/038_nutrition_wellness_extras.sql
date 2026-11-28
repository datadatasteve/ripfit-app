-- Migration 038 (Phase 1B-2): nutrition and wellness extras.
--
-- Additive only: new tables, and new nullable columns or columns with
-- defaults. Nothing is dropped or renamed, and no existing row changes value.
-- The 1B-1 code keeps working against it. Safe to re-run.
--
--  1. Craving log (SAS): a food and portion the user craved, avoided or not.
--  2. Label-submission queue, with temporary photos (deleted on approve or
--     reject, or when a pending submission is cleaned up after 60 days).
--  3. Barcode food overrides: reuse user_food_overrides (004), unchanged.
--  4. Trainer-forked foods (schema only; trainer endpoints come in 1C).
--  5. Body measurements: extend user_metrics (001, unused by the app so far).
--  6. Weight reminders (in-app only): user settings.
--  7. Habit calendar stickers.

-- ── 1. Craving log ───────────────────────────────────────────────────────────
-- The nutrition values are computed when the entry is saved (like meal_foods),
-- so later edits to the food do not rewrite history. food_name is a copy so an
-- entry still reads if the food is deleted.
CREATE TABLE IF NOT EXISTS craving_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id     INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  food_name   TEXT NOT NULL,
  barcode     VARCHAR(20),
  amount      NUMERIC(10,2) NOT NULL,
  unit        VARCHAR(20) NOT NULL DEFAULT 'g',
  grams       NUMERIC(10,2),
  calories    NUMERIC(10,2),
  fat_g       NUMERIC(10,2),
  sugar_g     NUMERIC(10,2),
  note        TEXT,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  log_date    DATE NOT NULL,              -- the user's calendar date of logged_at
  avoided     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT craving_logs_amount_positive CHECK (amount > 0),
  CONSTRAINT craving_logs_values_nonneg CHECK (
    (grams IS NULL OR grams >= 0) AND (calories IS NULL OR calories >= 0)
    AND (fat_g IS NULL OR fat_g >= 0) AND (sugar_g IS NULL OR sugar_g >= 0))
);
CREATE INDEX IF NOT EXISTS idx_craving_logs_user_date ON craving_logs (user_id, log_date);

-- ── 2. Label-submission queue ────────────────────────────────────────────────
-- kind 'new_food' proposes a food; 'correction' proposes new values for food_id.
-- proposed = { name, brand, serving_size, serving_unit, calories_per_100g, ... }.
CREATE TABLE IF NOT EXISTS food_label_submissions (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL,
  food_id              INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  barcode              VARCHAR(20),
  proposed             JSONB NOT NULL DEFAULT '{}'::jsonb,
  note                 TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  reject_reason        TEXT,
  reviewed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  result_food_id       INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT food_label_submissions_kind_allowed CHECK (kind IN ('new_food', 'correction')),
  CONSTRAINT food_label_submissions_status_allowed CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);
CREATE INDEX IF NOT EXISTS idx_food_label_submissions_status ON food_label_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_food_label_submissions_user ON food_label_submissions (user_id);

-- Temporary photos (at most 3 per submission, checked by the API). Rows are
-- deleted as soon as the submission is approved, rejected or expired.
CREATE TABLE IF NOT EXISTS food_label_photos (
  id             SERIAL PRIMARY KEY,
  submission_id  INTEGER NOT NULL REFERENCES food_label_submissions(id) ON DELETE CASCADE,
  content_type   TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  data           BYTEA NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT food_label_photos_type_allowed CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT food_label_photos_size_range CHECK (byte_size BETWEEN 1 AND 2097152)
);
CREATE INDEX IF NOT EXISTS idx_food_label_photos_submission ON food_label_photos (submission_id);

-- ── 3. Barcode overrides ─────────────────────────────────────────────────────
-- user_food_overrides (004) already holds one per-user override per food
-- (calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, per 100 g; NULL =
-- use the food's value). It is reused as is: no change here.

-- ── 4. Trainer-forked foods (schema only) ────────────────────────────────────
ALTER TABLE foods ADD COLUMN IF NOT EXISTS forked_from_food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS forked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS forked_at TIMESTAMPTZ;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS fork_visibility TEXT;   -- private | clients | public; NULL = not a fork

-- ── 5. Body measurements (user_metrics) ──────────────────────────────────────
-- Stored metric (kg, cm, 3 decimals so lb and inch values round-trip); the API converts to and from the user's units_weight
-- (lbs → lb and inches, kg → kg and cm). body_composition JSONB stays as is.
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS body_fat_pct NUMERIC(5,2);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS neck_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS shoulders_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS chest_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS waist_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS hips_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS arm_left_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS arm_right_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS thigh_left_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS thigh_right_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS calf_left_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS calf_right_cm NUMERIC(7,3);
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS measured_at TIMESTAMPTZ;
ALTER TABLE user_metrics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_metrics_user_date ON user_metrics (user_id, metric_date);

-- ── 6. Weight reminders (in-app only) ────────────────────────────────────────
-- mode: off | every_n_days | weekdays. weekdays: 0 = Mon … 6 = Sun (as habits).
-- anchor: the date the schedule was saved (every-N counts from it until the
-- first weigh-in). dismissed_on: today's reminder was dismissed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_reminder_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_reminder_every_days SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_reminder_weekdays SMALLINT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_reminder_anchor DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_reminder_dismissed_on DATE;

-- ── 7. Habit calendar stickers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_stickers (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sticker_date  DATE NOT NULL,
  sticker       TEXT NOT NULL,           -- a short emoji or label (free text)
  note          TEXT,
  habit_id      INTEGER REFERENCES habits(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT calendar_stickers_sticker_length CHECK (length(btrim(sticker)) BETWEEN 1 AND 32)
);
CREATE INDEX IF NOT EXISTS idx_calendar_stickers_user_date ON calendar_stickers (user_id, sticker_date);

-- ── Constraints on new columns of existing tables (guarded by name) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foods_fork_visibility_allowed') THEN
    ALTER TABLE foods ADD CONSTRAINT foods_fork_visibility_allowed
      CHECK (fork_visibility IS NULL OR fork_visibility IN ('private', 'clients', 'public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_metrics_values_range') THEN
    ALTER TABLE user_metrics ADD CONSTRAINT user_metrics_values_range CHECK (
      (weight_kg IS NULL OR weight_kg > 0) AND (body_fat_pct IS NULL OR body_fat_pct BETWEEN 0 AND 100)
      AND (neck_cm IS NULL OR neck_cm > 0) AND (shoulders_cm IS NULL OR shoulders_cm > 0)
      AND (chest_cm IS NULL OR chest_cm > 0) AND (waist_cm IS NULL OR waist_cm > 0)
      AND (hips_cm IS NULL OR hips_cm > 0) AND (arm_left_cm IS NULL OR arm_left_cm > 0)
      AND (arm_right_cm IS NULL OR arm_right_cm > 0) AND (thigh_left_cm IS NULL OR thigh_left_cm > 0)
      AND (thigh_right_cm IS NULL OR thigh_right_cm > 0) AND (calf_left_cm IS NULL OR calf_left_cm > 0)
      AND (calf_right_cm IS NULL OR calf_right_cm > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_weight_reminder_mode_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_weight_reminder_mode_allowed
      CHECK (weight_reminder_mode IN ('off', 'every_n_days', 'weekdays'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_weight_reminder_every_days_range') THEN
    ALTER TABLE users ADD CONSTRAINT users_weight_reminder_every_days_range
      CHECK (weight_reminder_every_days IS NULL OR weight_reminder_every_days BETWEEN 1 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_weight_reminder_weekdays_range') THEN
    ALTER TABLE users ADD CONSTRAINT users_weight_reminder_weekdays_range
      CHECK (weight_reminder_weekdays IS NULL OR weight_reminder_weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_foods_forked_from ON foods (forked_from_food_id) WHERE forked_from_food_id IS NOT NULL;
