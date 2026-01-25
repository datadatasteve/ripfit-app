// ============================================================================
// Nutrition Routes
// ============================================================================
const express = require('express');
const router = express.Router();
const nutritionController = require('../controllers/nutritionController');

// Food search and lookup
router.get('/foods/search', nutritionController.searchFoods);
router.get('/foods/:id', nutritionController.getFoodById);

// Barcode scanning
router.post('/foods/barcode/:barcode', nutritionController.scanBarcode);

// Meal logging
router.post('/meals', nutritionController.logMeal);
router.get('/meals/:date', nutritionController.getMealsByDate);

// Daily nutrition totals
router.get('/nutrition/daily/:date', nutritionController.getDailyNutrition);

module.exports = router;
