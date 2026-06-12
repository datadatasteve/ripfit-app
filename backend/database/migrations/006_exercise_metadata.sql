-- Migration 006: Add exercise metadata columns
-- Adds muscles_primary, muscles_secondary, force, level, mechanic

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS muscles_primary text[],
  ADD COLUMN IF NOT EXISTS muscles_secondary text[],
  ADD COLUMN IF NOT EXISTS force VARCHAR(20),
  ADD COLUMN IF NOT EXISTS level VARCHAR(20),
  ADD COLUMN IF NOT EXISTS mechanic VARCHAR(20);

-- Verify
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'exercises' ORDER BY ordinal_position;
