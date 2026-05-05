// ============================================================================
// Nutrition Routes
// ============================================================================
const authenticate = require('../middleware/auth');
const express = require('express');
const router = express.Router();
const nutritionController = require('../controllers/nutritionController');

// Food search and lookup
router.get('/foods/search', nutritionController.searchFoods);
router.get('/foods/:id', nutritionController.getFoodById);

// Barcode scanning
router.post('/foods/barcode/:barcode', nutritionController.scanBarcode);

// Meal logging
router.post('/meals', authenticate, nutritionController.logMeal);
router.get('/meals/:date', authenticate, nutritionController.getMealsByDate);

// Daily nutrition totals
router.get('/nutrition/daily/:date', authenticate, nutritionController.getDailyNutrition);

module.exports = router;
