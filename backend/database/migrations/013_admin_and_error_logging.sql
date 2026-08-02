-- Migration 013: Admin system, bug reports, error logging

-- Admin flag on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Set initial admin account
UPDATE users SET is_admin = TRUE WHERE email = 'datamansteve@gmail.com';

-- Bug reports submitted by users
CREATE TABLE IF NOT EXISTS bug_reports (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  current_view  TEXT,                    -- which page/tab they were on
  user_agent    TEXT,
  app_version   TEXT,
  status        TEXT NOT NULL DEFAULT 'open',  -- open, in_progress, resolved, wont_fix
  admin_notes   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Frontend error logs (auto-captured crashes)
CREATE TABLE IF NOT EXISTS error_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  error_message TEXT NOT NULL,
  error_stack   TEXT,
  component     TEXT,                    -- React component that crashed
  current_view  TEXT,                    -- which page/tab they were on
  user_agent    TEXT,
  url           TEXT,
  severity      TEXT NOT NULL DEFAULT 'error',  -- error, warning, info
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved);

