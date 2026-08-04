// ============================================================================
// Nutrition Controller
// ============================================================================
const { pool } = require('../config/database');
const usdaApi = require('../../services/usda-api');

// ============================================================================
// FOOD SEARCH & LOOKUP
// ============================================================================

/**
 * Search foods by name
 * GET /api/v1/nutrition/foods/search?q=chicken&limit=20
 */
const searchFoods = async (req, res) => {
  const { q, limit = 20 } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, brand, calories_per_100g, protein_per_100g, 
              carbs_per_100g, fat_per_100g, serving_size, serving_unit, source
       FROM foods
       WHERE name ILIKE $1 OR brand ILIKE $1
       ORDER BY name
       LIMIT $2`,
      [`%${q}%`, limit]
    );

    res.json({
      query: q,
      count: result.rows.length,
      foods: result.rows
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search foods' });
  }
};

/**
 * Get food by ID
 * GET /api/v1/nutrition/foods/:id
 */
const getFoodById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM foods WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Food not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get food error:', error);
    res.status(500).json({ error: 'Failed to get food' });
  }
};

// ============================================================================
// BARCODE SCANNING
// ============================================================================

/**
 * Scan barcode - checks DB first, then USDA API, then saves
 * POST /api/v1/nutrition/foods/barcode/:barcode
 */
const scanBarcode = async (req, res) => {
  const { barcode } = req.params;

  try {
    // Step 1: Check if barcode exists in local database
    const existingFood = await pool.query(
      `SELECT * FROM foods WHERE gtin_upc = $1`,
      [barcode]
    );

    if (existingFood.rows.length > 0) {
      return res.json({
        source: 'database',
        food: existingFood.rows[0]
      });
    }

    // Step 2: Query USDA API
    const usdaFood = await usdaApi.searchByBarcode(barcode);

    if (!usdaFood) {
      return res.status(404).json({ 
        error: 'Barcode not found',
        barcode: barcode 
      });
    }

    // Step 3: Parse nutrition data
    const nutrition = usdaApi.parseNutrients(usdaFood);

    // Step 4: Save to database
    const savedFood = await pool.query(
      `INSERT INTO foods (
        name, serving_size, serving_unit, calories_per_100g, protein_per_100g,
        carbs_per_100g, fat_per_100g, fiber_per_100g, sugar_per_100g,
        gtin_upc, brand, source, usda_fdc_id, is_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        nutrition.name,
        100, // USDA data is per 100g
        'g',
        nutrition.calories,
        nutrition.protein_g,
        nutrition.carbs_g,
        nutrition.fat_g,
        nutrition.fiber_g,
        nutrition.sugar_g,
        nutrition.gtin_upc,
        nutrition.brand_owner,
        nutrition.source,
        nutrition.usda_fdc_id,
        true
      ]
    );

    res.status(201).json({
      source: 'usda',
      food: savedFood.rows[0]
    });

  } catch (error) {
    console.error('Barcode scan error:', error);
    res.status(500).json({ error: 'Failed to scan barcode' });
  }
};

// ============================================================================
// MEAL LOGGING
// ============================================================================

/**
 * Log a meal with foods
 * POST /api/v1/nutrition/meals
 * Body: {
 *   user_id: 1,
 *   meal_date: '2026-01-25',
 *   meal_type: 'breakfast',
 *   foods: [
 *     { food_id: 123, serving_size: 150, serving_unit: 'g' }
 *   ]
 * }
 */
const logMeal = async (req, res) => {
  const user_id = req.user.userId; // Get from JWT token
  const { meal_date, meal_type, meal_name, foods } = req.body;

  // Validation
  if (!user_id || !meal_date || !meal_type || !foods || !Array.isArray(foods)) {
    return res.status(400).json({ 
      error: 'Missing required fields: user_id, meal_date, meal_type, foods' 
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create meal
    const mealResult = await client.query(
      `INSERT INTO meals (user_id, meal_date, meal_type, meal_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, meal_date, meal_type, meal_name || null]
    );

    const meal = mealResult.rows[0];

    // Add foods to meal
    const mealFoods = [];
    for (const item of foods) {
      const { food_id, serving_size, serving_unit } = item;

      // Get food nutrition data
      const foodData = await client.query(
        `SELECT * FROM foods WHERE id = $1`,
        [food_id]
      );

      if (foodData.rows.length === 0) {
        throw new Error(`Food ${food_id} not found`);
      }

      const food = foodData.rows[0];

      // Calculate nutrition based on serving size (food data is per 100g)
      // Convert serving to grams before calculating (food data is always per 100g)
      const UNIT_TO_GRAMS = { g: 1, ml: 1, oz: 28.3495, lb: 453.592, kg: 1000 };
      const servingInGrams = serving_size * (UNIT_TO_GRAMS[serving_unit] || 1);
      const multiplier = servingInGrams / 100;
      const calories = food.calories_per_100g * multiplier;
      const protein = food.protein_per_100g * multiplier;
      const carbs = food.carbs_per_100g * multiplier;
      const fat = food.fat_per_100g * multiplier;
      const fiber = (food.fiber_per_100g || 0) * multiplier;

      // Insert meal_food entry
      const mealFoodResult = await client.query(
        `INSERT INTO meal_foods (
          meal_id, food_id, serving_size, serving_unit,
          calories, protein, carbs, fat, fiber
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [meal.id, food_id, serving_size, serving_unit, calories, protein, carbs, fat, fiber]
      );

      mealFoods.push(mealFoodResult.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      meal,
      foods: mealFoods
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Log meal error:', error);
    res.status(500).json({ error: error.message || 'Failed to log meal' });
  } finally {
    client.release();
  }
};

/**
 * Get meals for a specific date
 * GET /api/v1/nutrition/meals/:date
 * Example: /api/v1/nutrition/meals/2026-01-25?user_id=1
 */
const getMealsByDate = async (req, res) => {
  const { date } = req.params;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT 
        m.id, m.meal_type, m.meal_name, m.created_at,
        COALESCE(json_agg(
          json_build_object(
            'meal_food_id', mf.id,
            'food_id', mf.food_id,
            'food_name', f.name,
            'brand', f.brand,
            'serving_size', mf.serving_size,
            'serving_unit', mf.serving_unit,
            'calories', mf.calories,
            'protein', mf.protein,
            'carbs', mf.carbs,
            'fat', mf.fat,
            'fiber', mf.fiber
          ) ORDER BY mf.id
        ) FILTER (WHERE mf.id IS NOT NULL), '[]') AS foods
       FROM meals m
       LEFT JOIN meal_foods mf ON m.id = mf.meal_id
       LEFT JOIN foods f ON mf.food_id = f.id
       WHERE m.user_id = $1 AND m.meal_date = $2
       GROUP BY m.id
       ORDER BY m.created_at`,
      [user_id, date]
    );

    res.json({ date, meals: result.rows });
  } catch (error) {
    console.error('Get meals error:', error);
    res.status(500).json({ error: 'Failed to get meals' });
  }
};

// ============================================================================
// DAILY NUTRITION TOTALS
// ============================================================================

/**
 * Get daily nutrition totals
 * GET /api/v1/nutrition/nutrition/daily/:date?user_id=1
 */
const getDailyNutrition = async (req, res) => {
  const { date } = req.params;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT * FROM daily_nutrition_summary
       WHERE user_id = $1 AND summary_date = $2`,
      [user_id, date]
    );

    if (result.rows.length === 0) {
      return res.json({
        date,
        total_calories: 0,
        total_protein: 0,
        total_carbs: 0,
        total_fat: 0,
        total_fiber: 0
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get daily nutrition error:', error);
    res.status(500).json({ error: 'Failed to get daily nutrition' });
  }
};


// ============================================================================
// USDA LIVE SEARCH
// ============================================================================

/**
 * Search USDA FoodData Central live
 * GET /api/v1/nutrition/foods/usda-search?q=chicken&type=all
 * type: 'all' | 'branded' | 'foundation'
 */
const searchUSDA = async (req, res) => {
  const { q, type = 'all', limit = 25 } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  try {
    const dataType = type === 'branded' ? ['Branded']
      : type === 'foundation' ? ['Foundation', 'SR Legacy']
      : null; // null = all types

    // Search strategy:
    // SR Legacy has complete macro data for basic/raw foods (better than Foundation)
    // Branded covers packaged foods
    // Foundation often has incomplete macro data — skip it
    let foods = [];
    if (!dataType || type === 'all') {
      const [srRes, brandedRes] = await Promise.all([
        usdaApi.searchFoods(q, { dataType: ['SR Legacy'], pageSize: 10 }),
        usdaApi.searchFoods(q, { dataType: ['Branded'], pageSize: parseInt(limit) - 10 }),
      ]);
      foods = [...(srRes.foods || []), ...(brandedRes.foods || [])];
    } else if (type === 'foundation') {
      // If explicitly requesting foundation, use SR Legacy as it has better data
      const res = await usdaApi.searchFoods(q, { dataType: ['SR Legacy'], pageSize: parseInt(limit) });
      foods = res.foods || [];
    } else {
      const res = await usdaApi.searchFoods(q, { dataType, pageSize: parseInt(limit) });
      foods = res.foods || [];
    }
    const results = { foods };

    // Normalize to a consistent shape the frontend can use
    // DEBUG: log first food's nutrients to see field structure
    if (foods && foods[0]) console.log('[USDA DEBUG] first food nutrients:', JSON.stringify(foods[0].foodNutrients?.slice(0,4)));
    const foodList = (foods || []).map(f => {
      const nutrients = {};
      if (f.foodNutrients) {
        // USDA search uses nutrientNumber (string e.g. "208") not nutrientId (int)
        // Map covers both formats
        const map = {
          '208': 'calories', '1008': 'calories',
          '203': 'protein',  '1003': 'protein',
          '204': 'fat',      '1004': 'fat',
          '205': 'carbs',    '1005': 'carbs',
          '291': 'fiber',    '1079': 'fiber',
          '269': 'sugar',    '2000': 'sugar',
        };
        f.foodNutrients.forEach(n => {
          // USDA uses different field names across data types:
          // Foundation: nutrientId (int), SR Legacy: nutrientId, Branded: nutrientNumber (string)
          // Some endpoints also use n.number or n.nutrient.number
          const rawId = n.nutrientId ?? n.nutrientNumber ?? n.number ?? n.nutrient?.number ?? '';
          const id = String(rawId);
          const key = map[id];
          if (key && n.value != null) nutrients[key] = n.value;
          // Also try matching by nutrientName as fallback
          if (!key && n.nutrientName) {
            const nameMap = {
              'Energy': 'calories', 'Protein': 'protein',
              'Total lipid (fat)': 'fat', 'Carbohydrate, by difference': 'carbs',
              'Fiber, total dietary': 'fiber', 'Sugars, total': 'sugar',
            };
            const nameKey = nameMap[n.nutrientName];
            if (nameKey && n.value != null) nutrients[nameKey] = n.value;
          }
        });
      }
      return {
        fdc_id: f.fdcId,
        name: f.description,
        brand: f.brandOwner || f.brandName || null,
        data_type: f.dataType,
        serving_size: f.servingSize || 100,
        serving_unit: f.servingSizeUnit || 'g',
        calories_per_100g: nutrients.calories || 0,
        protein_per_100g: nutrients.protein || 0,
        carbs_per_100g: nutrients.carbs || 0,
        fat_per_100g: nutrients.fat || 0,
        fiber_per_100g: nutrients.fiber || 0,
      };
    });

    res.json({ query: q, count: foodList.length, foods: foodList });
  } catch (err) {
    console.error('USDA search error:', err.message);
    res.status(500).json({ error: 'Food search failed' });
  }
};

// ============================================================================
// CUSTOM FOOD CREATION
// ============================================================================

/**
 * Create a custom food entry
 * POST /api/v1/nutrition/foods/custom
 */
const createCustomFood = async (req, res) => {
  const user_id = req.user.userId;
  const {
    name, brand, serving_size = 100, serving_unit = 'g',
    calories_per_100g, protein_per_100g, carbs_per_100g,
    fat_per_100g, fiber_per_100g = 0, sugar_per_100g = 0
  } = req.body;

  if (!name || calories_per_100g == null) {
    return res.status(400).json({ error: 'name and calories_per_100g required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO foods
         (name, brand, serving_size, serving_unit, calories_per_100g, protein_per_100g,
          carbs_per_100g, fat_per_100g, fiber_per_100g, sugar_per_100g,
          source, created_by_user_id, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'custom',$11,false)
       RETURNING *`,
      [name, brand || null, serving_size, serving_unit,
       calories_per_100g, protein_per_100g || 0, carbs_per_100g || 0,
       fat_per_100g || 0, fiber_per_100g, sugar_per_100g, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createCustomFood error:', err);
    res.status(500).json({ error: 'Failed to create food' });
  }
};

// ============================================================================
// MEAL / FOOD ITEM MANAGEMENT
// ============================================================================

/**
 * Delete an entire meal
 * DELETE /api/v1/nutrition/meals/:mealId
 */
const deleteMeal = async (req, res) => {
  const user_id = req.user.userId;
  const { mealId } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM meals WHERE id = $1 AND user_id = $2 RETURNING id',
      [mealId, user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Meal not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteMeal error:', err);
    res.status(500).json({ error: 'Failed to delete meal' });
  }
};

/**
 * Remove a food item from a meal
 * DELETE /api/v1/nutrition/meal-foods/:mealFoodId
 */
const deleteMealFood = async (req, res) => {
  const user_id = req.user.userId;
  const { mealFoodId } = req.params;
  try {
    // Verify ownership via join
    const result = await pool.query(
      `DELETE FROM meal_foods mf
       USING meals m
       WHERE mf.id = $1 AND mf.meal_id = m.id AND m.user_id = $2
       RETURNING mf.id`,
      [mealFoodId, user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteMealFood error:', err);
    res.status(500).json({ error: 'Failed to remove food' });
  }
};

/**
 * Update serving size of a food item in a meal
 * PUT /api/v1/nutrition/meal-foods/:mealFoodId
 */
const updateMealFood = async (req, res) => {
  const user_id = req.user.userId;
  const { mealFoodId } = req.params;
  const { serving_size } = req.body;

  if (!serving_size || serving_size <= 0) {
    return res.status(400).json({ error: 'serving_size required' });
  }

  try {
    // Get current food data to recalculate macros
    const current = await pool.query(
      `SELECT mf.food_id, f.calories_per_100g, f.protein_per_100g,
              f.carbs_per_100g, f.fat_per_100g, f.fiber_per_100g
       FROM meal_foods mf
       JOIN meals m ON mf.meal_id = m.id
       JOIN foods f ON mf.food_id = f.id
       WHERE mf.id = $1 AND m.user_id = $2`,
      [mealFoodId, user_id]
    );

    if (current.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

    const food = current.rows[0];
    const UNIT_TO_GRAMS = { g: 1, ml: 1, oz: 28.3495, lb: 453.592, kg: 1000 };
    const servingInGrams = serving_size * (UNIT_TO_GRAMS[req.body.serving_unit || 'g'] || 1);
    const mult = servingInGrams / 100;

    const result = await pool.query(
      `UPDATE meal_foods
       SET serving_size = $1,
           calories = $2, protein = $3, carbs = $4, fat = $5, fiber = $6
       WHERE id = $7
       RETURNING *`,
      [
        serving_size,
        food.calories_per_100g * mult,
        food.protein_per_100g * mult,
        food.carbs_per_100g * mult,
        food.fat_per_100g * mult,
        (food.fiber_per_100g || 0) * mult,
        mealFoodId
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateMealFood error:', err);
    res.status(500).json({ error: 'Failed to update serving' });
  }
};

/**
 * Get or derive daily macro targets from user goals
 * GET /api/v1/nutrition/goals
 */
const getNutritionGoals = async (req, res) => {
  const user_id = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT goals, weight_kg, workout_rating_prefs FROM users WHERE id = $1',
      [user_id]
    );
    const { goals = [], weight_kg } = result.rows[0] || {};

    // Default targets — sensible starting points
    let targets = { calories: 2000, protein: 150, carbs: 200, fat: 65, fiber: 25 };

    // If user has weight loss goal with target, adjust
    const wl = goals.find(g => g.type === 'weight_loss');
    if (wl?.details?.current_weight && weight_kg) {
      const weightLbs = parseFloat(wl.details.current_weight);
      // ~0.8g protein per lb body weight, moderate deficit
      targets.protein = Math.round(weightLbs * 0.8);
      targets.calories = Math.round(weightLbs * 13); // light deficit multiplier
      targets.carbs = Math.round((targets.calories * 0.4) / 4);
      targets.fat = Math.round((targets.calories * 0.3) / 9);
    }

    const mg = goals.find(g => g.type === 'muscle_gain');
    if (mg?.details?.current_weight) {
      const weightLbs = parseFloat(mg.details.current_weight);
      targets.protein = Math.round(weightLbs * 1.0); // 1g/lb for muscle gain
      targets.calories = Math.round(weightLbs * 16); // slight surplus
      targets.carbs = Math.round((targets.calories * 0.45) / 4);
      targets.fat = Math.round((targets.calories * 0.25) / 9);
    }

    res.json({ targets });
  } catch (err) {
    console.error('getNutritionGoals error:', err);
    res.status(500).json({ error: 'Failed to get nutrition goals' });
  }
};

// ============================================================================
// DEBUG ENDPOINT (remove after fixing nutrient mapping)
// GET /api/v1/nutrition/debug/usda?q=chicken
// ============================================================================
const debugUSDA = async (req, res) => {
  const { q = 'chicken breast' } = req.query;
  try {
    const result = await usdaApi.searchFoods(q, {
      dataType: ['SR Legacy'],
      pageSize: 1,
    });
    const food = result.foods?.[0];
    if (!food) return res.json({ error: 'no results' });

    const allNutrients = food.foodNutrients || [];
    const totalCount = allNutrients.length;

    // Find key nutrients by ID or name
    const targetIds = new Set(['208', '203', '204', '205', '291', '269',
                                '1008', '1003', '1004', '1005', '1079', '2000']);
    const targetNames = new Set(['Energy', 'Protein', 'Total lipid (fat)',
                                  'Carbohydrate, by difference', 'Fiber, total dietary']);

    const keyNutrients = allNutrients.filter(n => {
      const id = String(n.nutrientId || n.nutrientNumber || '');
      return targetIds.has(id) || targetNames.has(n.nutrientName);
    });

    // Show what our mapping produces
    const map = {
      '208': 'calories', '1008': 'calories',
      '203': 'protein',  '1003': 'protein',
      '204': 'fat',      '1004': 'fat',
      '205': 'carbs',    '1005': 'carbs',
      '291': 'fiber',    '1079': 'fiber',
    };
    const mapped = {};
    allNutrients.forEach(n => {
      const id = String(n.nutrientId || n.nutrientNumber || '');
      const key = map[id];
      if (key) mapped[key] = n.value;
    });

    res.json({
      description: food.description,
      dataType: food.dataType,
      total_nutrient_count: totalCount,
      key_nutrients_found: keyNutrients,
      mapping_result: mapped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  searchFoods,
  getFoodById,
  scanBarcode,
  searchUSDA,
  createCustomFood,
  logMeal,
  getMealsByDate,
  getDailyNutrition,
  deleteMeal,
  deleteMealFood,
  updateMealFood,
  getNutritionGoals,
  debugUSDA,
};
