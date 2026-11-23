-- Migration 031: workouts.status has no default (Phase 0A-1, section 04).
--
-- 030 already dropped the default, but 030 shipped to production before the
-- code that sets status on every insert, so a temporary
-- `SET DEFAULT 'in_progress'` was applied in the Northflank shell to keep
-- workout starts working. Every insert path now sets status explicitly, so
-- the default goes again and a missing status fails loudly (NOT NULL).
-- Idempotent: both statements are no-ops when already in this state.

ALTER TABLE workouts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE workouts ALTER COLUMN status SET NOT NULL;
