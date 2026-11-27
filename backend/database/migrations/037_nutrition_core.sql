-- Migration 037 (Phase 1B-1): nutrition core data.
--
-- Additive only: new tables, and new nullable columns or columns with
-- defaults. No food or logged row changes value. Safe to re-run.
--
--  1. My foods (archive instead of delete) and saved foods.
--  2. Recipes and their ingredients (manual and imported drafts).
--  3. Nutrient list (key-value store) and extra nutrients per food.
--  4. Nutrient goals; user nutrition settings (diet type, BMR formula,
--     overconsumption threshold, water goal and preset).
--  5. Meals per day (named slots); meal diary (unassigned entries); the
--     meal_type check also accepts 'snacks' (owner decision: the Nutrition
--     screen sends 'snacks', which the 002 check rejected).
--  6. Meal templates.
--  7. Water log (one total per user per day, in fluid ounces like the app).

-- ── 1. My foods and saved foods ──────────────────────────────────────────────
-- A user's own food (foods.created_by_user_id) that has been logged is
-- archived, not deleted: meal_foods.food_id cascades on delete.
ALTER TABLE foods ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS saved_foods (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id     INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, food_id)
);

-- ── 2. Recipes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  servings       NUMERIC(8,2),
  steps          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- list of strings
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'ready',         -- draft (imported, to review) | ready
  source_type    TEXT NOT NULL DEFAULT 'manual',        -- manual | url | text | file
  source_url     TEXT,
  source_title   TEXT,
  source_author  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT recipes_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT recipes_status_allowed CHECK (status IN ('draft', 'ready')),
  CONSTRAINT recipes_source_type_allowed CHECK (source_type IN ('manual', 'url', 'text', 'file')),
  CONSTRAINT recipes_servings_positive CHECK (servings IS NULL OR servings > 0)
);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes (user_id);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id           SERIAL PRIMARY KEY,
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  order_index  INTEGER NOT NULL DEFAULT 1,
  raw_text     TEXT,                 -- the line as written (kept for unmatched lines)
  quantity     NUMERIC(10,3),
  unit         TEXT,
  name         TEXT,
  food_id      INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  notes        TEXT,
  CONSTRAINT recipe_ingredients_has_text CHECK (raw_text IS NOT NULL OR name IS NOT NULL),
  CONSTRAINT recipe_ingredients_quantity_nonneg CHECK (quantity IS NULL OR quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients (recipe_id, order_index);

-- ── 3. Nutrients (key-value) ─────────────────────────────────────────────────
-- food_column: the existing foods column that stays authoritative for that
-- nutrient (per 100 g). Every other nutrient lives in food_nutrients.
CREATE TABLE IF NOT EXISTS nutrients (
  key              TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL,
  category         TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  food_column      TEXT,
  usda_nutrient_id INTEGER
);

INSERT INTO nutrients (key, name, unit, category, sort_order, food_column, usda_nutrient_id) VALUES
  ('energy',              'Energy',               'kcal', 'energy',   1, 'calories_per_100g', 1008),
  ('protein',             'Protein',              'g',    'macro',    2, 'protein_per_100g',  1003),
  ('carbohydrate',        'Carbohydrate',         'g',    'macro',    3, 'carbs_per_100g',    1005),
  ('fat',                 'Fat',                  'g',    'macro',    4, 'fat_per_100g',      1004),
  ('fiber',               'Fiber',                'g',    'carb',    10, 'fiber_per_100g',    1079),
  ('sugar',               'Sugar',                'g',    'carb',    11, 'sugar_per_100g',    2000),
  ('added_sugar',         'Added sugar',          'g',    'carb',    12, NULL, 1235),
  ('saturated_fat',       'Saturated fat',        'g',    'fat',     20, NULL, 1258),
  ('monounsaturated_fat', 'Monounsaturated fat',  'g',    'fat',     21, NULL, 1292),
  ('polyunsaturated_fat', 'Polyunsaturated fat',  'g',    'fat',     22, NULL, 1293),
  ('trans_fat',           'Trans fat',            'g',    'fat',     23, NULL, 1257),
  ('cholesterol',         'Cholesterol',          'mg',   'fat',     24, NULL, 1253),
  ('sodium',              'Sodium',               'mg',   'mineral', 30, 'sodium_per_100g',   1093),
  ('potassium',           'Potassium',            'mg',   'mineral', 31, NULL, 1092),
  ('calcium',             'Calcium',              'mg',   'mineral', 32, NULL, 1087),
  ('iron',                'Iron',                 'mg',   'mineral', 33, NULL, 1089),
  ('magnesium',           'Magnesium',            'mg',   'mineral', 34, NULL, 1090),
  ('phosphorus',          'Phosphorus',           'mg',   'mineral', 35, NULL, 1091),
  ('zinc',                'Zinc',                 'mg',   'mineral', 36, NULL, 1095),
  ('copper',              'Copper',               'mg',   'mineral', 37, NULL, 1098),
  ('manganese',           'Manganese',            'mg',   'mineral', 38, NULL, 1101),
  ('selenium',            'Selenium',             'µg',   'mineral', 39, NULL, 1103),
  ('iodine',              'Iodine',               'µg',   'mineral', 40, NULL, 1100),
  ('vitamin_a',           'Vitamin A (RAE)',      'µg',   'vitamin', 50, NULL, 1106),
  ('vitamin_c',           'Vitamin C',            'mg',   'vitamin', 51, NULL, 1162),
  ('vitamin_d',           'Vitamin D',            'µg',   'vitamin', 52, NULL, 1114),
  ('vitamin_e',           'Vitamin E',            'mg',   'vitamin', 53, NULL, 1109),
  ('vitamin_k',           'Vitamin K',            'µg',   'vitamin', 54, NULL, 1185),
  ('thiamin',             'Thiamin (B1)',         'mg',   'vitamin', 55, NULL, 1165),
  ('riboflavin',          'Riboflavin (B2)',      'mg',   'vitamin', 56, NULL, 1166),
  ('niacin',              'Niacin (B3)',          'mg',   'vitamin', 57, NULL, 1167),
  ('pantothenic_acid',    'Pantothenic acid (B5)','mg',   'vitamin', 58, NULL, 1170),
  ('vitamin_b6',          'Vitamin B6',           'mg',   'vitamin', 59, NULL, 1175),
  ('biotin',              'Biotin (B7)',          'µg',   'vitamin', 60, NULL, 1176),
  ('folate',              'Folate (DFE)',         'µg',   'vitamin', 61, NULL, 1177),
  ('vitamin_b12',         'Vitamin B12',          'µg',   'vitamin', 62, NULL, 1178),
  ('choline',             'Choline',              'mg',   'vitamin', 63, NULL, 1180),
  ('caffeine',            'Caffeine',             'mg',   'other',   70, NULL, 1057),
  ('alcohol',             'Alcohol',              'g',    'other',   71, NULL, 1018),
  ('water',               'Water',                'g',    'other',   72, NULL, 1051)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS food_nutrients (
  food_id          INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  nutrient_key     TEXT NOT NULL REFERENCES nutrients(key) ON DELETE CASCADE,
  amount_per_100g  NUMERIC(12,4) NOT NULL,
  PRIMARY KEY (food_id, nutrient_key),
  CONSTRAINT food_nutrients_amount_nonneg CHECK (amount_per_100g >= 0)
);

-- ── 4. Goals and settings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrient_goals (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutrient_key  TEXT NOT NULL REFERENCES nutrients(key) ON DELETE CASCADE,
  period        TEXT NOT NULL DEFAULT 'daily',     -- daily | weekly
  direction     TEXT NOT NULL,                     -- at_least | at_most | range
  mode          TEXT NOT NULL DEFAULT 'amount',    -- amount (nutrient unit) | percent_calories (macros)
  target        NUMERIC(12,4),
  min_value     NUMERIC(12,4),
  max_value     NUMERIC(12,4),
  soft_limit    NUMERIC(12,4),
  hard_limit    NUMERIC(12,4),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT nutrient_goals_period_allowed CHECK (period IN ('daily', 'weekly')),
  CONSTRAINT nutrient_goals_direction_allowed CHECK (direction IN ('at_least', 'at_most', 'range')),
  CONSTRAINT nutrient_goals_mode_allowed CHECK (mode IN ('amount', 'percent_calories')),
  CONSTRAINT nutrient_goals_values_nonneg CHECK (
    (target IS NULL OR target >= 0) AND (min_value IS NULL OR min_value >= 0) AND (max_value IS NULL OR max_value >= 0)
    AND (soft_limit IS NULL OR soft_limit >= 0) AND (hard_limit IS NULL OR hard_limit >= 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nutrient_goals_user_key_period ON nutrient_goals (user_id, nutrient_key, period);

ALTER TABLE users ADD COLUMN IF NOT EXISTS diet_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE users ADD COLUMN IF NOT EXISTS diet_custom JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bmr_formula TEXT NOT NULL DEFAULT 'mifflin_st_jeor';
ALTER TABLE users ADD COLUMN IF NOT EXISTS overconsumption_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_goal_oz NUMERIC(6,1);
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_preset_oz NUMERIC(6,1);

-- ── 5. Meals per day and the meal diary ──────────────────────────────────────
-- No rows = the default four (Breakfast, Lunch, Dinner, Snacks).
CREATE TABLE IF NOT EXISTS user_meal_slots (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_number  SMALLINT NOT NULL,
  name         TEXT NOT NULL,
  target_time  TIME,
  PRIMARY KEY (user_id, slot_number),
  CONSTRAINT user_meal_slots_number_range CHECK (slot_number BETWEEN 1 AND 8),
  CONSTRAINT user_meal_slots_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- meal_slot: which of the user's meals (1-8); NULL on rows logged before 1B-1
-- (their slot follows meal_type). unassigned: logged with no meal yet
-- (stored as meal_type 'other'; counts in daily totals).
ALTER TABLE meals ADD COLUMN IF NOT EXISTS meal_slot SMALLINT;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS unassigned BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 6. Meal templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_templates (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT meal_templates_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_meal_templates_user ON meal_templates (user_id);

CREATE TABLE IF NOT EXISTS meal_template_items (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,
  food_id       INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  serving_size  NUMERIC(8,2) NOT NULL,
  serving_unit  VARCHAR(20) NOT NULL DEFAULT 'g',
  order_index   INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT meal_template_items_serving_positive CHECK (serving_size > 0)
);
CREATE INDEX IF NOT EXISTS idx_meal_template_items_template ON meal_template_items (template_id, order_index);

-- ── 7. Water ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS water_logs (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  amount_oz   NUMERIC(7,1) NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'app',           -- app | import
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, log_date),
  CONSTRAINT water_logs_amount_nonneg CHECK (amount_oz >= 0),
  CONSTRAINT water_logs_source_allowed CHECK (source IN ('app', 'import'))
);

-- ── Constraints on existing tables (guarded) ─────────────────────────────────
DO $$
BEGIN
  -- meal_type: also accept 'snacks' (the app's value); every 002 value stays.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meals_meal_type_check' AND conrelid = 'meals'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%snacks%'
  ) THEN
    ALTER TABLE meals DROP CONSTRAINT IF EXISTS meals_meal_type_check;
    ALTER TABLE meals ADD CONSTRAINT meals_meal_type_check
      CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'snacks', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meals_meal_slot_range') THEN
    ALTER TABLE meals ADD CONSTRAINT meals_meal_slot_range CHECK (meal_slot IS NULL OR meal_slot BETWEEN 1 AND 8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_diet_type_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_diet_type_allowed
      CHECK (diet_type IN ('standard', 'vegetarian', 'vegan', 'keto', 'low_carb', 'high_protein', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_bmr_formula_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_bmr_formula_allowed
      CHECK (bmr_formula IN ('mifflin_st_jeor', 'harris_benedict', 'katch_mcardle'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_overconsumption_threshold_range') THEN
    ALTER TABLE users ADD CONSTRAINT users_overconsumption_threshold_range
      CHECK (overconsumption_threshold_pct BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals (user_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_foods_created_by ON foods (created_by_user_id) WHERE created_by_user_id IS NOT NULL;
