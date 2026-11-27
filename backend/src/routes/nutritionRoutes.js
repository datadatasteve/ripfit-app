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


// ── Phase 1B-1 ────────────────────────────────────────────────────────────────
const nc = require('../controllers/nutritionCoreController');
const rc = require('../controllers/recipeController');
// My foods and saved foods
router.get('/my-foods', authenticate, nc.listMyFoods);
router.post('/my-foods', authenticate, nc.createMyFood);
router.get('/my-foods/:id', authenticate, nc.getMyFood);
router.put('/my-foods/:id', authenticate, nc.updateMyFood);
router.delete('/my-foods/:id', authenticate, nc.deleteMyFood);
router.get('/saved-foods', authenticate, nc.listSavedFoods);
router.put('/saved-foods/:foodId', authenticate, nc.saveFood);
router.delete('/saved-foods/:foodId', authenticate, nc.unsaveFood);
// Nutrients (key-value store)
router.get('/nutrients', authenticate, nc.listNutrients);
router.get('/foods/:id/nutrients', authenticate, nc.getFoodNutrients);
router.put('/foods/:id/nutrients', authenticate, nc.putFoodNutrients);
// Nutrient goals
router.get('/nutrient-goals', authenticate, nc.listGoals);
router.put('/nutrient-goals', authenticate, nc.putGoal);
router.delete('/nutrient-goals/:id', authenticate, nc.deleteGoal);
router.get('/goal-status', authenticate, nc.getGoalStatus);
// Settings and BMR
router.get('/settings', authenticate, nc.getSettings);
router.put('/settings', authenticate, nc.putSettings);
router.get('/bmr', authenticate, nc.getBmr);
// Recipes
router.get('/recipes', authenticate, rc.listRecipes);
router.post('/recipes', authenticate, rc.createRecipe);
router.post('/recipes/import/url', authenticate, rc.importFromUrl);
router.post('/recipes/import/text', authenticate, rc.importFromText);
router.post('/recipes/import/file', authenticate, rc.importFromFile);
router.get('/recipes/:id', authenticate, rc.getRecipe);
router.put('/recipes/:id', authenticate, rc.updateRecipe);
router.delete('/recipes/:id', authenticate, rc.deleteRecipe);

// Meals per day, diary, day API, templates, copy day, water (Phase 1B-1)
const md = require('../controllers/mealDiaryController');
router.get('/meal-slots', authenticate, md.getSlots);
router.put('/meal-slots', authenticate, md.putSlots);
router.get('/days/:date', authenticate, md.getDay);
router.post('/days/:date/copy', authenticate, md.copyDay);
router.post('/diary', authenticate, md.logEntry);
router.put('/diary/:mealFoodId/assign', authenticate, md.assignEntry);
router.get('/meal-templates', authenticate, md.listTemplates);
router.post('/meal-templates', authenticate, md.createTemplate);
router.get('/meal-templates/:id', authenticate, md.getTemplate);
router.put('/meal-templates/:id', authenticate, md.updateTemplate);
router.delete('/meal-templates/:id', authenticate, md.deleteTemplate);
router.post('/meal-templates/:id/apply', authenticate, md.applyTemplate);
router.get('/water', authenticate, md.listWater);
router.post('/water/import', authenticate, md.importWater);
router.put('/water-settings', authenticate, md.putWaterSettings);
router.get('/water/:date', authenticate, md.getWater);
router.put('/water/:date', authenticate, md.setWater);
router.post('/water/:date/add', authenticate, md.addWater);

module.exports = router;
