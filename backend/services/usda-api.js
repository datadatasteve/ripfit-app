// ============================================================================
// USDA FoodData Central API Client
// ============================================================================
// Purpose: Interact with USDA API for barcode scanning and food lookups
// Documentation: https://fdc.nal.usda.gov/api-guide.html

const axios = require('axios');

const USDA_API_BASE = 'https://api.nal.usda.gov/fdc/v1';
const API_KEY = process.env.USDA_API_KEY;

if (!API_KEY) {
  console.error('❌ USDA_API_KEY not found in environment variables');
  console.error('   Add your API key to .env file: USDA_API_KEY=your-key-here');
  process.exit(1);
}

// ============================================================================
// FOOD SEARCH
// ============================================================================

/**
 * Search for foods by query string
 * @param {string} query - Search term (e.g., "chicken breast")
 * @param {object} options - Search options
 * @returns {Promise<Array>} - Array of food results
 */
async function searchFoods(query, options = {}) {
  const {
    dataType = null,        // 'Foundation', 'Branded', 'SR Legacy', etc.
    pageSize = 25,          // Results per page (max 200)
    pageNumber = 1,         // Page number
    sortBy = 'dataType.keyword',  // Sort field
    sortOrder = 'asc'       // 'asc' or 'desc'
  } = options;

  try {
    const params = {
      api_key: API_KEY,
      query: query,
      pageSize: pageSize,
      pageNumber: pageNumber,
      sortBy: sortBy,
      sortOrder: sortOrder
    };

    if (dataType) {
      params.dataType = dataType;
    }

    const response = await axios.get(`${USDA_API_BASE}/foods/search`, { params });
    
    return {
      totalHits: response.data.totalHits,
      currentPage: response.data.currentPage,
      totalPages: response.data.totalPages,
      foods: response.data.foods || []
    };
  } catch (error) {
    console.error('Error searching foods:', error.message);
    throw error;
  }
}

// ============================================================================
// BARCODE LOOKUP
// ============================================================================

/**
 * Search for food by barcode (GTIN/UPC)
 * @param {string} barcode - Barcode number
 * @returns {Promise<object|null>} - Food data or null if not found
 */
async function searchByBarcode(barcode) {
  try {
    const result = await searchFoods('', {
      dataType: 'Branded',
      pageSize: 1
    });

    // Add barcode to search params
    const params = {
      api_key: API_KEY,
      query: '',
      dataType: 'Branded',
      pageSize: 1,
      gtinUpc: barcode  // Barcode filter
    };

    const response = await axios.get(`${USDA_API_BASE}/foods/search`, { params });
    
    if (response.data.foods && response.data.foods.length > 0) {
      return response.data.foods[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error searching by barcode:', error.message);
    return null;
  }
}

// ============================================================================
// GET FOOD BY ID
// ============================================================================

/**
 * Get detailed food information by FDC ID
 * @param {number} fdcId - USDA FoodData Central ID
 * @param {string} format - 'abridged' or 'full'
 * @returns {Promise<object>} - Detailed food data
 */
async function getFoodById(fdcId, format = 'abridged') {
  try {
    const params = {
      api_key: API_KEY,
      format: format
    };

    const response = await axios.get(`${USDA_API_BASE}/food/${fdcId}`, { params });
    return response.data;
  } catch (error) {
    console.error(`Error fetching food ${fdcId}:`, error.message);
    throw error;
  }
}

// ============================================================================
// PARSE NUTRIENTS FROM FOOD DATA
// ============================================================================

/**
 * Extract nutrition values from USDA food data
 * @param {object} food - USDA food object
 * @returns {object} - Standardized nutrition object
 */
function parseNutrients(food) {
  const nutrients = {};

  // Nutrient ID mapping (USDA uses specific IDs for each nutrient)
  const nutrientMap = {
    1008: 'calories',      // Energy (kcal)
    1003: 'protein_g',     // Protein
    1004: 'fat_g',         // Total lipid (fat)
    1005: 'carbs_g',       // Carbohydrate, by difference
    1079: 'fiber_g',       // Fiber, total dietary
    2000: 'sugar_g'        // Sugars, total including NLEA
  };

  // Extract nutrient values
  if (food.foodNutrients) {
    food.foodNutrients.forEach(nutrient => {
      const key = nutrientMap[nutrient.nutrientId];
      if (key) {
        nutrients[key] = nutrient.value || 0;
      }
    });
  }

  // Calculate serving size
  let serving_size = '100g';  // Default
  if (food.servingSize && food.servingSizeUnit) {
    serving_size = `${food.servingSize}${food.servingSizeUnit}`;
  }

  return {
    name: food.description || food.brandedFoodCategory || 'Unknown',
    serving_size: serving_size,
    calories: nutrients.calories || 0,
    protein_g: nutrients.protein_g || 0,
    carbs_g: nutrients.carbs_g || 0,
    fat_g: nutrients.fat_g || 0,
    fiber_g: nutrients.fiber_g || 0,
    sugar_g: nutrients.sugar_g || 0,
    // Branded food specific
    gtin_upc: food.gtinUpc || null,
    brand_owner: food.brandOwner || null,
    brand_name: food.brandName || null,
    ingredients: food.ingredients || null,
    usda_fdc_id: food.fdcId,
    source: food.dataType === 'Branded' ? 'usda_branded' : 'usda_foundation'
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  searchFoods,
  searchByBarcode,
  getFoodById,
  parseNutrients
};
