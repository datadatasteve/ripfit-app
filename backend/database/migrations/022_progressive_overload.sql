-- Migration 022: Progressive overload preferences on programs

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS overload_strategy  VARCHAR DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS overload_increment NUMERIC;
