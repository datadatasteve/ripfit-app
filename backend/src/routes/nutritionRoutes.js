// ============================================================================
// Nutrition Routes
// ============================================================================
const authenticate = require('../middleware/auth');
const express = require('express');
const router = express.Router();
const nutritionController = require('../controllers/nutritionController');

// Food search and lookup
router.get('/foods/search', nutritionController.searchFoods);
router.get('/foods/usda-search', nutritionController.searchUSDA);
router.get('/foods/:id', nutritionController.getFoodById);

// Custom food creation
router.post('/foods/custom', authenticate, nutritionController.createCustomFood);

// Barcode scanning
router.post('/foods/barcode/:barcode', nutritionController.scanBarcode);

// Meal logging
router.post('/meals', authenticate, nutritionController.logMeal);
router.get('/meals/:date', authenticate, nutritionController.getMealsByDate);
router.delete('/meals/:mealId', authenticate, nutritionController.deleteMeal);

// Meal food items
router.put('/meal-foods/:mealFoodId', authenticate, nutritionController.updateMealFood);
router.delete('/meal-foods/:mealFoodId', authenticate, nutritionController.deleteMealFood);

// Daily nutrition totals
router.get('/daily/:date', authenticate, nutritionController.getDailyNutrition);

// Nutrition goals (derived from user profile)
router.get('/goals', authenticate, nutritionController.getNutritionGoals);

module.exports = router;
