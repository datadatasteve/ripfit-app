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
      const multiplier = serving_size / 100;
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
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query parameter required' });
  }

  try {
    const result = await pool.query(
      `SELECT 
        m.id, m.meal_type, m.meal_name, m.created_at,
        json_agg(json_build_object(
          'food_id', mf.food_id,
          'food_name', f.name,
          'serving_size', mf.serving_size,
          'serving_unit', mf.serving_unit,
          'calories', mf.calories,
          'protein', mf.protein,
          'carbs', mf.carbs,
          'fat', mf.fat,
          'fiber', mf.fiber
        )) as foods
       FROM meals m
       LEFT JOIN meal_foods mf ON m.id = mf.meal_id
       LEFT JOIN foods f ON mf.food_id = f.id
       WHERE m.user_id = $1 AND m.meal_date = $2
       GROUP BY m.id
       ORDER BY m.created_at`,
      [user_id, date]
    );

    res.json({
      date,
      meals: result.rows
    });
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
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query parameter required' });
  }

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
// EXPORTS
// ============================================================================

module.exports = {
  searchFoods,
  getFoodById,
  scanBarcode,
  logMeal,
  getMealsByDate,
  getDailyNutrition
};
