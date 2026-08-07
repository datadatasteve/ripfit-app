-- Migration 017: Cardio goal fields on workout_exercises
-- Allows cardio exercises added to strength workouts to store pace/distance/duration goals.

ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_duration_seconds INTEGER;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_distance          NUMERIC(10,3);
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_distance_unit     TEXT;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_pace              NUMERIC(10,4); -- decimal minutes per unit
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_pace_unit         TEXT;          -- 'min/mile','min/km','mph','split/500m','split/Xm'
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_laps              INTEGER;       -- swimming
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS goal_lap_distance      NUMERIC(8,2);  -- metres per lap (pool size)
