-- Migration: 009_cardio_sessions.sql
-- Description: Add cardio session logging
-- Date: 2026-07-27

CREATE TABLE cardio_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    cardio_type VARCHAR(50) NOT NULL,

    -- Timestamps
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,

    -- Optional pre-set goals
    goal_duration_seconds INTEGER,
    goal_distance DECIMAL(8,2),
    goal_distance_unit VARCHAR(10) DEFAULT 'mi',
    goal_speed DECIMAL(6,2),

    -- Logged metrics (all optional)
    duration_seconds INTEGER,          -- actual duration; falls back to timer if blank
    distance DECIMAL(8,2),
    distance_unit VARCHAR(10) DEFAULT 'mi',
    avg_heart_rate INTEGER,
    max_heart_rate INTEGER,
    calories_burned INTEGER,
    avg_speed DECIMAL(6,2),
    max_speed DECIMAL(6,2),
    elevation_gain DECIMAL(8,2),       -- outdoor cycling/running/hiking

    -- Heart rate zones (seconds spent in each zone, device-sourced)
    hr_zone_1_seconds INTEGER,
    hr_zone_2_seconds INTEGER,
    hr_zone_3_seconds INTEGER,
    hr_zone_4_seconds INTEGER,
    hr_zone_5_seconds INTEGER,

    -- Notes
    pre_session_notes TEXT,
    mid_session_notes TEXT,
    post_session_notes TEXT,

    -- Status
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'cancelled')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cardio_user_date ON cardio_sessions(user_id, session_date);
CREATE INDEX idx_cardio_type ON cardio_sessions(cardio_type);

CREATE TRIGGER update_cardio_sessions_updated_at
    BEFORE UPDATE ON cardio_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE cardio_sessions IS 'Logged cardio workouts (cycling, running, HIIT, etc.)';
COMMENT ON COLUMN cardio_sessions.duration_seconds IS 'Actual duration; if null, derived from start_time/end_time';
COMMENT ON COLUMN cardio_sessions.elevation_gain IS 'In feet; applicable for outdoor cycling, running, hiking';
