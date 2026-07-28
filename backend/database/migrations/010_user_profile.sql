-- Migration 010: User profile, preferences, and email verification

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name       TEXT,
  ADD COLUMN IF NOT EXISTS profile_picture    TEXT,           -- base64 encoded image
  ADD COLUMN IF NOT EXISTS height_cm          NUMERIC(5,1),   -- stored in cm, displayed per unit pref
  ADD COLUMN IF NOT EXISTS weight_kg          NUMERIC(5,1),   -- stored in kg, displayed per unit pref
  ADD COLUMN IF NOT EXISTS date_of_birth      DATE,
  ADD COLUMN IF NOT EXISTS gender             TEXT,           -- 'male','female','non-binary','prefer_not_to_say'
  ADD COLUMN IF NOT EXISTS units_weight       TEXT NOT NULL DEFAULT 'lbs',  -- 'lbs' or 'kg'
  ADD COLUMN IF NOT EXISTS units_distance     TEXT NOT NULL DEFAULT 'mi',   -- 'mi' or 'km'
  ADD COLUMN IF NOT EXISTS theme_preference   TEXT NOT NULL DEFAULT 'system', -- 'light','dark','system'
  ADD COLUMN IF NOT EXISTS goals              JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verify_token TEXT,
  ADD COLUMN IF NOT EXISTS email_verify_sent_at TIMESTAMPTZ;

-- Index for token lookups during email verification
CREATE INDEX IF NOT EXISTS idx_users_email_verify_token ON users(email_verify_token)
  WHERE email_verify_token IS NOT NULL;

  