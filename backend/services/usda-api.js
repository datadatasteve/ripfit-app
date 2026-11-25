// ============================================================================
// USDA FoodData Central API Client
// ============================================================================
// Purpose: Interact with USDA API for barcode scanning and food lookups
// Documentation: https://fdc.nal.usda.gov/api-guide.html

const axios = require('axios');

const USDA_API_BASE = 'https://api.nal.usda.gov/fdc/v1';
const API_KEY = process.env.USDA_API_KEY;

if (!API_KEY) {
  console.warn('⚠️  USDA_API_KEY not set — food search and barcode lookup will be unavailable.');
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
      // USDA API expects comma-separated string, not an array
      params.dataType = Array.isArray(dataType) ? dataType.join(',') : dataType;
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
  const code = String(barcode || '').replace(/\D/g, '');
  if (!code) return null;
  const bare = code.replace(/^0+/, '');
  if (!bare) return null;
  // USDA stores branded GTINs in mixed lengths (some UPC-A 12-digit, some
  // padded to GTIN-14 with leading zeros) and its search only matches the
  // exact string, so a scanned 12-digit UPC can miss a 14-digit record. Try
  // the scanned form, then the padded lengths, and accept only a result whose
  // GTIN is the same number once leading zeros are ignored.
  const variants = [...new Set([code, bare.padStart(14, '0'), bare.padStart(13, '0'), bare.padStart(12, '0')])];
  try {
    for (const query of variants) {
      const response = await axios.get(`${USDA_API_BASE}/foods/search`, {
        params: { api_key: API_KEY, query, dataType: 'Branded', pageSize: 50 },
      });
      const match = (response.data.foods || []).find(
        food => String(food.gtinUpc || '').replace(/^0+/, '') === bare
      );
      if (match) return match;
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
  // Branded records can list a nutrient more than once (e.g. one set "per
  // 100 unit measure" and another derived from a different serving). The
  // first entry is the provider's per-100 value; later ones must not
  // overwrite it (the last-wins loop turned Cheerios' 359 kcal into 117).
  if (food.foodNutrients) {
    food.foodNutrients.forEach(nutrient => {
      const key = nutrientMap[nutrient.nutrientId];
      if (key && nutrients[key] === undefined && nutrient.value != null) {
        nutrients[key] = nutrient.value;
      }
    });
  }

  // The label serving (USDA's values stay per 100 g / 100 ml). Only gram and
  // millilitre servings are kept, since the meal maths converts by weight.
  const unit = String(food.servingSizeUnit || '').toLowerCase();
  const servingUnit = ['g', 'grm', 'gm'].includes(unit) ? 'g' : ['ml', 'mlt'].includes(unit) ? 'ml' : null;
  const servingAmount = Number(food.servingSize);
  const hasServing = servingUnit && Number.isFinite(servingAmount) && servingAmount > 0;
  const serving_size = hasServing ? servingAmount : 100;

  return {
    name: food.description || food.brandedFoodCategory || 'Unknown',
    serving_size,
    serving_unit: hasServing ? servingUnit : 'g',
    household_serving: food.householdServingFullText || null,
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

