-- Migration 007: Add status column to workouts
-- Distinguishes completed vs cancelled workouts for trainer/data visibility

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed';

-- Existing finished workouts (end_time set) default to 'completed' already via DEFAULT.
-- No backfill needed since this is a new column on existing rows.