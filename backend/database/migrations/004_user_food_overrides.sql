-- ============================================================================
-- Migration: 004_user_food_overrides.sql
-- Purpose: User-specific food nutrition overrides
-- ============================================================================

-- Users can override nutrition data for foods they log frequently
-- This allows for:
-- 1. Regional formula differences (e.g., UK vs US versions)
-- 2. Package variations (different sizes, reformulations)
-- 3. Outdated database corrections (user has current packaging)
-- 4. Personal measurements (user weighed portions themselves)

-- IMPORTANT: This is NOT for creating variants (strawberry vs peach yogurt)
-- Variants should be separate entries in the 'foods' table with different barcodes
-- This table is for user-specific adjustments to existing foods

CREATE TABLE IF NOT EXISTS user_food_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  
  -- Overridable nutrition fields
  -- NULL means "use the value from foods table"
  -- Non-NULL means "use this custom value for this user"
  calories DECIMAL(8, 2),
  protein_g DECIMAL(8, 2),
  carbs_g DECIMAL(8, 2),
  fat_g DECIMAL(8, 2),
  fiber_g DECIMAL(8, 2),
  sugar_g DECIMAL(8, 2),
  
  -- Optional: User's reason for the override
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Each user can have only one override per food
  CONSTRAINT unique_user_food_override UNIQUE(user_id, food_id),
  
  -- Ensure non-negative values
  CONSTRAINT positive_calories CHECK (calories IS NULL OR calories >= 0),
  CONSTRAINT positive_protein CHECK (protein_g IS NULL OR protein_g >= 0),
  CONSTRAINT positive_carbs CHECK (carbs_g IS NULL OR carbs_g >= 0),
  CONSTRAINT positive_fat CHECK (fat_g IS NULL OR fat_g >= 0),
  CONSTRAINT positive_fiber CHECK (fiber_g IS NULL OR fiber_g >= 0),
  CONSTRAINT positive_sugar CHECK (sugar_g IS NULL OR sugar_g >= 0)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast lookup of user's overrides
CREATE INDEX idx_user_food_overrides_user ON user_food_overrides(user_id);

-- Fast lookup of which users have overridden a specific food
CREATE INDEX idx_user_food_overrides_food ON user_food_overrides(food_id);

-- Composite index for the most common query pattern
CREATE INDEX idx_user_food_overrides_user_food ON user_food_overrides(user_id, food_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE user_food_overrides IS 
  'User-specific nutrition overrides for foods - handles regional variants, package differences, and personal measurements';

COMMENT ON COLUMN user_food_overrides.user_id IS 
  'User who created this override';

COMMENT ON COLUMN user_food_overrides.food_id IS 
  'The food being overridden';

COMMENT ON COLUMN user_food_overrides.calories IS 
  'User''s custom calorie value (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.protein_g IS 
  'User''s custom protein value in grams (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.carbs_g IS 
  'User''s custom carbohydrate value in grams (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.fat_g IS 
  'User''s custom fat value in grams (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.fiber_g IS 
  'User''s custom fiber value in grams (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.sugar_g IS 
  'User''s custom sugar value in grams (NULL = use foods table value)';

COMMENT ON COLUMN user_food_overrides.notes IS 
  'Why this override exists (e.g., "UK version", "New package formula 2025", "Weighed myself")';

-- ============================================================================
-- EXAMPLE USAGE
-- ============================================================================

-- Query to get food data with user's overrides applied:
-- 
-- SELECT 
--   f.id,
--   f.name,
--   COALESCE(o.calories, f.calories) as calories,
--   COALESCE(o.protein_g, f.protein_g) as protein_g,
--   COALESCE(o.carbs_g, f.carbs_g) as carbs_g,
--   COALESCE(o.fat_g, f.fat_g) as fat_g,
--   COALESCE(o.fiber_g, f.fiber_g) as fiber_g,
--   COALESCE(o.sugar_g, f.sugar_g) as sugar_g
-- FROM foods f
-- LEFT JOIN user_food_overrides o 
--   ON f.id = o.food_id AND o.user_id = :userId
-- WHERE f.id = :foodId;