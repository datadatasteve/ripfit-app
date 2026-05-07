// ============================================================================
// Workout Routes
// ============================================================================
const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const authenticate = require('../middleware/auth');

// Exercise search and lookup
router.get('/exercises/search', workoutController.searchExercises);
router.get('/exercises/:id', workoutController.getExerciseById);

// Workout logging
router.post('/', authenticate, workoutController.logWorkout);
router.get('/', authenticate, workoutController.getWorkouts);

module.exports = router;
