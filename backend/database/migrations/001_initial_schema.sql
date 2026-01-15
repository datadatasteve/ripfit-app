-- Migration: 001_initial_schema.sql
-- Description: Create all core tables for RipFit application
-- Date: 2026-01-14

-- Enable UUID extension for future use
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CATEGORY 1: USER/AUTHENTICATION
-- ============================================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    oauth_provider VARCHAR(50),
    oauth_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT oauth_unique UNIQUE (oauth_provider, oauth_id)
);

-- ============================================================================
-- CATEGORY 2: EXERCISE LIBRARY
-- ============================================================================

CREATE TABLE exercises (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    equipment_type VARCHAR(50),
    is_custom BOOLEAN DEFAULT FALSE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exercise_alternatives (
    id SERIAL PRIMARY KEY,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    alternative_exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT different_exercises CHECK (exercise_id != alternative_exercise_id)
);

CREATE TABLE muscles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    muscle_group VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exercise_muscles (
    id SERIAL PRIMARY KEY,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle_id INTEGER NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
    involvement_level VARCHAR(20) NOT NULL CHECK (involvement_level IN ('PRIMARY', 'SECONDARY', 'STABILIZER')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_exercise_muscle UNIQUE (exercise_id, muscle_id)
);

-- ============================================================================
-- CATEGORY 3: WORKOUT ROUTINES (PLANNING)
-- ============================================================================

CREATE TABLE workout_routines (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE routine_exercises (
    id SERIAL PRIMARY KEY,
    routine_id INTEGER NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    target_sets INTEGER,
    target_reps INTEGER,
    target_weight DECIMAL(6,2),
    superset_group INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_order CHECK (order_index > 0)
);

CREATE TABLE exercise_replacements (
    id SERIAL PRIMARY KEY,
    routine_id INTEGER NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE,
    original_exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    replacement_exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT different_replacement_exercises CHECK (original_exercise_id != replacement_exercise_id),
    CONSTRAINT valid_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE routine_additions_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    routine_id INTEGER NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('ALWAYS_ADD', 'ALWAYS_ASK', 'NEVER_ADD')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_routine_addition_pref UNIQUE (user_id, routine_id, exercise_id)
);

-- ============================================================================
-- CATEGORY 4: WORKOUT LOGGING (EXECUTION)
-- ============================================================================

CREATE TABLE workouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    routine_id INTEGER REFERENCES workout_routines(id) ON DELETE SET NULL,
    workout_date DATE NOT NULL,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    overall_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_workout_time CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE TABLE workout_exercises (
    id SERIAL PRIMARY KEY,
    workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    exercise_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_workout_order CHECK (order_index > 0)
);

CREATE TABLE workout_sets (
    id SERIAL PRIMARY KEY,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    reps_completed INTEGER NOT NULL,
    weight_used DECIMAL(6,2) NOT NULL,
    rpe INTEGER CHECK (rpe >= 1 AND rpe <= 10),
    rest_seconds INTEGER CHECK (rest_seconds >= 0),
    tempo VARCHAR(20),
    set_type VARCHAR(20) DEFAULT 'normal' CHECK (set_type IN ('normal', 'warmup', 'drop', 'superset')),
    superset_group INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_set_number CHECK (set_number > 0),
    CONSTRAINT positive_reps CHECK (reps_completed > 0),
    CONSTRAINT non_negative_weight CHECK (weight_used >= 0)
);

-- ============================================================================
-- CATEGORY 5: PROGRESS TRACKING
-- ============================================================================

CREATE TABLE user_metrics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    scan_method VARCHAR(100),
    body_composition JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE progress_photos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    photo_filename VARCHAR(255) NOT NULL,
    photo_date DATE NOT NULL,
    metric_id INTEGER REFERENCES user_metrics(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nutrition_plans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date DATE NOT NULL,
    metric_id INTEGER REFERENCES user_metrics(id) ON DELETE SET NULL,
    daily_calories INTEGER CHECK (daily_calories > 0),
    daily_protein DECIMAL(6,2) CHECK (daily_protein >= 0),
    daily_carbs DECIMAL(6,2) CHECK (daily_carbs >= 0),
    daily_fat DECIMAL(6,2) CHECK (daily_fat >= 0),
    meals_per_day INTEGER CHECK (meals_per_day > 0),
    calories_per_meal INTEGER CHECK (calories_per_meal >= 0),
    protein_per_meal DECIMAL(6,2) CHECK (protein_per_meal >= 0),
    carbs_per_meal DECIMAL(6,2) CHECK (carbs_per_meal >= 0),
    fat_per_meal DECIMAL(6,2) CHECK (fat_per_meal >= 0),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- CATEGORY 6: IMPORT/EXPORT
-- ============================================================================

CREATE TABLE user_export_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    auto_export_enabled BOOLEAN DEFAULT FALSE,
    export_frequency VARCHAR(20) CHECK (export_frequency IN ('weekly', 'monthly')),
    export_format VARCHAR(20) CHECK (export_format IN ('csv', 'json', 'both')),
    export_destination VARCHAR(50) CHECK (export_destination IN ('email', 'google_drive', 'dropbox')),
    last_export_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_oauth ON users(oauth_provider, oauth_id);

-- Exercises
CREATE INDEX idx_exercises_name ON exercises(name);
CREATE INDEX idx_exercises_category ON exercises(category);
CREATE INDEX idx_exercises_user ON exercises(created_by_user_id);

-- Exercise relationships
CREATE INDEX idx_exercise_muscles_exercise ON exercise_muscles(exercise_id);
CREATE INDEX idx_exercise_muscles_muscle ON exercise_muscles(muscle_id);

-- Routines
CREATE INDEX idx_routines_user ON workout_routines(user_id);
CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id);
CREATE INDEX idx_routine_exercises_order ON routine_exercises(routine_id, order_index);

-- Workouts
CREATE INDEX idx_workouts_user_date ON workouts(user_id, workout_date);
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_sets_exercise ON workout_sets(workout_exercise_id);

-- Progress tracking
CREATE INDEX idx_metrics_user_date ON user_metrics(user_id, metric_date);
CREATE INDEX idx_photos_user_date ON progress_photos(user_id, photo_date);

-- JSONB index for body composition queries
CREATE INDEX idx_body_composition_gin ON user_metrics USING GIN (body_composition);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workout_routines_updated_at BEFORE UPDATE ON workout_routines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nutrition_plans_updated_at BEFORE UPDATE ON nutrition_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_export_prefs_updated_at BEFORE UPDATE ON user_export_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts and authentication data';
COMMENT ON TABLE exercises IS 'Master exercise library (system + user-custom)';
COMMENT ON TABLE workout_routines IS 'Saved workout programs/templates';
COMMENT ON TABLE workouts IS 'Individual gym sessions';
COMMENT ON TABLE workout_sets IS 'Individual sets logged during workouts';
COMMENT ON TABLE user_metrics IS 'Body composition and measurement data (JSONB for flexibility)';
COMMENT ON TABLE nutrition_plans IS 'Dietary targets and macro breakdowns (Phase 3 feature)';

COMMENT ON COLUMN user_metrics.body_composition IS 'JSONB field storing flexible body composition data from various scanners';
COMMENT ON COLUMN progress_photos.photo_filename IS 'Filename only - photos stored locally on user device';
COMMENT ON COLUMN exercise_replacements.end_date IS 'NULL means permanent replacement';
COMMENT ON COLUMN routine_exercises.superset_group IS 'NULL = normal, 1/2/3 = superset group number';
