-- Migration: 002_nutrition_tables.sql
-- Description: Add nutrition tracking tables
-- Date: 2026-01-15

-- ============================================================================
-- NUTRITION DATABASE (Food Library)
-- ============================================================================

CREATE TABLE foods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(255),
    description TEXT,
    
    -- Nutritional values per 100g/100ml
    calories_per_100g DECIMAL(8,2) NOT NULL,
    protein_per_100g DECIMAL(6,2) NOT NULL DEFAULT 0,
    carbs_per_100g DECIMAL(6,2) NOT NULL DEFAULT 0,
    fat_per_100g DECIMAL(6,2) NOT NULL DEFAULT 0,
    fiber_per_100g DECIMAL(6,2) DEFAULT 0,
    sugar_per_100g DECIMAL(6,2) DEFAULT 0,
    sodium_per_100g DECIMAL(6,2) DEFAULT 0, -- in mg
    
    -- Serving information
    serving_size DECIMAL(8,2), -- default serving size
    serving_unit VARCHAR(20), -- "g", "ml", "oz", "cup", "item", etc.
    
    -- Source tracking
    source VARCHAR(50) NOT NULL, -- "USDA", "custom", "branded"
    source_id VARCHAR(100), -- ID from source database
    
    -- Custom foods
    is_custom BOOLEAN DEFAULT FALSE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT positive_calories CHECK (calories_per_100g >= 0),
    CONSTRAINT positive_macros CHECK (
        protein_per_100g >= 0 AND 
        carbs_per_100g >= 0 AND 
        fat_per_100g >= 0
    )
);

-- ============================================================================
-- MEAL LOGGING
-- ============================================================================

CREATE TABLE meals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
    meal_name VARCHAR(255), -- optional custom name like "Pre-workout shake"
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE meal_foods (
    id SERIAL PRIMARY KEY,
    meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    
    -- How much was consumed
    serving_size DECIMAL(8,2) NOT NULL,
    serving_unit VARCHAR(20) NOT NULL,
    
    -- Calculated nutrition (stored for historical accuracy)
    calories DECIMAL(8,2) NOT NULL,
    protein DECIMAL(6,2) NOT NULL,
    carbs DECIMAL(6,2) NOT NULL,
    fat DECIMAL(6,2) NOT NULL,
    fiber DECIMAL(6,2),
    
    notes TEXT, -- e.g., "estimated portion"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT positive_serving CHECK (serving_size > 0)
);

-- ============================================================================
-- DAILY NUTRITION SUMMARY (Calculated View)
-- ============================================================================

-- This is a materialized view for performance
-- Aggregates all meals for each day
CREATE TABLE daily_nutrition_summary (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    
    -- Totals for the day
    total_calories DECIMAL(8,2) DEFAULT 0,
    total_protein DECIMAL(6,2) DEFAULT 0,
    total_carbs DECIMAL(6,2) DEFAULT 0,
    total_fat DECIMAL(6,2) DEFAULT 0,
    total_fiber DECIMAL(6,2) DEFAULT 0,
    
    -- Meal breakdown
    breakfast_calories DECIMAL(8,2) DEFAULT 0,
    lunch_calories DECIMAL(8,2) DEFAULT 0,
    dinner_calories DECIMAL(8,2) DEFAULT 0,
    snack_calories DECIMAL(8,2) DEFAULT 0,
    
    -- Comparison to plan
    nutrition_plan_id INTEGER REFERENCES nutrition_plans(id) ON DELETE SET NULL,
    calories_vs_target DECIMAL(8,2), -- difference from target
    protein_vs_target DECIMAL(6,2),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_user_date UNIQUE (user_id, summary_date)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Foods table
CREATE INDEX idx_foods_name ON foods(name);
CREATE INDEX idx_foods_source ON foods(source);
CREATE INDEX idx_foods_custom ON foods(is_custom, created_by_user_id);

-- Meals table
CREATE INDEX idx_meals_user_date ON meals(user_id, meal_date);
CREATE INDEX idx_meals_type ON meals(meal_type);

-- Meal foods table
CREATE INDEX idx_meal_foods_meal ON meal_foods(meal_id);
CREATE INDEX idx_meal_foods_food ON meal_foods(food_id);

-- Daily summary
CREATE INDEX idx_daily_summary_user_date ON daily_nutrition_summary(user_id, summary_date);

-- ============================================================================
-- TRIGGERS FOR AUTO-UPDATE
-- ============================================================================

-- Update foods updated_at
CREATE TRIGGER update_foods_updated_at BEFORE UPDATE ON foods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update meals updated_at
CREATE TRIGGER update_meals_updated_at BEFORE UPDATE ON meals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update daily summary updated_at
CREATE TRIGGER update_daily_nutrition_updated_at BEFORE UPDATE ON daily_nutrition_summary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- FUNCTION TO RECALCULATE DAILY SUMMARY
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_daily_nutrition(
    p_user_id INTEGER,
    p_date DATE
) RETURNS void AS $$
BEGIN
    -- Delete existing summary for this date
    DELETE FROM daily_nutrition_summary 
    WHERE user_id = p_user_id AND summary_date = p_date;
    
    -- Insert new calculated summary
    INSERT INTO daily_nutrition_summary (
        user_id,
        summary_date,
        total_calories,
        total_protein,
        total_carbs,
        total_fat,
        total_fiber,
        breakfast_calories,
        lunch_calories,
        dinner_calories,
        snack_calories
    )
    SELECT 
        p_user_id,
        p_date,
        COALESCE(SUM(mf.calories), 0),
        COALESCE(SUM(mf.protein), 0),
        COALESCE(SUM(mf.carbs), 0),
        COALESCE(SUM(mf.fat), 0),
        COALESCE(SUM(mf.fiber), 0),
        COALESCE(SUM(CASE WHEN m.meal_type = 'breakfast' THEN mf.calories ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN m.meal_type = 'lunch' THEN mf.calories ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN m.meal_type = 'dinner' THEN mf.calories ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN m.meal_type = 'snack' THEN mf.calories ELSE 0 END), 0)
    FROM meals m
    LEFT JOIN meal_foods mf ON m.id = mf.meal_id
    WHERE m.user_id = p_user_id AND m.meal_date = p_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER TO AUTO-UPDATE DAILY SUMMARY
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_recalculate_daily_nutrition()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate for the affected date
    IF TG_OP = 'DELETE' THEN
        PERFORM recalculate_daily_nutrition(
            (SELECT user_id FROM meals WHERE id = OLD.meal_id),
            (SELECT meal_date FROM meals WHERE id = OLD.meal_id)
        );
    ELSE
        PERFORM recalculate_daily_nutrition(
            (SELECT user_id FROM meals WHERE id = NEW.meal_id),
            (SELECT meal_date FROM meals WHERE id = NEW.meal_id)
        );
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to meal_foods table
CREATE TRIGGER meal_foods_update_summary
    AFTER INSERT OR UPDATE OR DELETE ON meal_foods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recalculate_daily_nutrition();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE foods IS 'Nutrition database - USDA foods, branded foods, and custom user foods';
COMMENT ON TABLE meals IS 'Logged meals with date and meal type';
COMMENT ON TABLE meal_foods IS 'Individual food items consumed in each meal';
COMMENT ON TABLE daily_nutrition_summary IS 'Aggregated daily nutrition totals (auto-calculated)';

COMMENT ON COLUMN foods.calories_per_100g IS 'Nutritional values standardized per 100g for consistency';
COMMENT ON COLUMN meal_foods.calories IS 'Calculated nutrition stored for historical accuracy if food database changes';
COMMENT ON FUNCTION recalculate_daily_nutrition IS 'Recalculates daily nutrition summary for a user and date';
