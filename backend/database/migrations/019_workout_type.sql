-- Migration 019: workout_type on workouts table + avg/max speed on cardio segments
-- Values: 'strength', 'cardio', 'mixed', 'open'
-- Set on start, updated dynamically as exercises are added.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS workout_type TEXT DEFAULT 'open';

-- Speed fields on cardio segments (per-segment avg/max for cycling/running data)
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS avg_speed NUMERIC(6,2);
ALTER TABLE workout_cardio_segments ADD COLUMN IF NOT EXISTS max_speed NUMERIC(6,2);

-- Backfill existing workouts based on title patterns (best-effort)
UPDATE workouts SET workout_type = 'cardio'
WHERE workout_title IS NOT NULL
  AND workout_type = 'open'
  AND (
    workout_title ILIKE '%cycling%' OR workout_title ILIKE '%running%' OR
    workout_title ILIKE '%hiking%'  OR workout_title ILIKE '%cardio%'  OR
    workout_title ILIKE '%treadmill%' OR workout_title ILIKE '%rowing%' OR
    workout_title ILIKE '%swimming%'  OR workout_title ILIKE '%walking%' OR
    workout_title ILIKE '%elliptical%' OR workout_title ILIKE '%HIIT%' OR
    workout_title ILIKE '%sprints%' OR workout_title ILIKE '%stair%'
  );
  