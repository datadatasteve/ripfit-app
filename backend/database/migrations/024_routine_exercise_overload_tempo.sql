-- Migration 024: Per-exercise progressive overload and lifting tempo on routine_exercises.
-- programs.overload_strategy / overload_increment (022) remain as program-wide
-- defaults; these per-exercise values override them when set.

ALTER TABLE routine_exercises
  ADD COLUMN IF NOT EXISTS overload_strategy varchar DEFAULT 'none'
    CHECK (overload_strategy IN ('none', 'weight', 'reps', 'sets')),
  ADD COLUMN IF NOT EXISTS overload_increment numeric,
  ADD COLUMN IF NOT EXISTS overload_schedule varchar DEFAULT 'linear'
    CHECK (overload_schedule IN ('linear', 'custom')),
  ADD COLUMN IF NOT EXISTS overload_week_targets jsonb,
  ADD COLUMN IF NOT EXISTS tempo_eccentric integer,
  ADD COLUMN IF NOT EXISTS tempo_pause integer,
  ADD COLUMN IF NOT EXISTS tempo_concentric integer;
