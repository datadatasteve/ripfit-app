// ============================================================================
// Workout Routes
// ============================================================================
const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const authenticate = require('../middleware/auth');

// Exercise search, browse, and lookup
router.get('/exercises/search', workoutController.searchExercises);
router.get('/exercises/browse', workoutController.browseExercises);
router.get('/exercises/:id', workoutController.getExerciseById);

// Workout history (must be before /:workoutId routes)
router.get('/history', authenticate, workoutController.getCombinedHistory);
router.get('/history/:id', authenticate, workoutController.getWorkoutDetail);

// Workout logging
router.post('/', authenticate, workoutController.logWorkout);
router.get('/', authenticate, workoutController.getWorkouts);

router.post('/:workoutId/sets', authenticate, workoutController.logWorkoutSet);
router.put('/:workoutId/finish', authenticate, workoutController.finishWorkout);
router.put('/:workoutId/cancel', authenticate, workoutController.cancelWorkout);
router.put('/:workoutId/notes', authenticate, workoutController.updateWorkoutNotes);

router.post('/:workoutId/exercises', authenticate, workoutController.addExerciseToWorkout); // add exercises to active workout
router.delete('/:workoutId/exercises/:exerciseId', authenticate, workoutController.deleteExerciseFromWorkout); // delete exercise from active workout
router.put('/:workoutId/exercises/:exerciseId/notes', authenticate, workoutController.updateExerciseNotes);

module.exports = router;
