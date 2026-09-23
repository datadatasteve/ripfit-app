-- Migration 023: Resolution context on exercise reports
-- Records what the admin changed, who resolved the report, and when.

ALTER TABLE exercise_reports
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS resolved_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
