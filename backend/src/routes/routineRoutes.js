// ============================================================================
// Routine Routes
// ============================================================================
const express = require('express');
const router = express.Router();
const routineController = require('../controllers/routineController');
const authenticate = require('../middleware/auth');

// All routine endpoints require authentication
router.post('/', authenticate, routineController.createRoutine);
router.get('/', authenticate, routineController.getRoutines);
router.get('/:id', authenticate, routineController.getRoutineById);
router.put('/:id', authenticate, routineController.updateRoutine);
router.delete('/:id', authenticate, routineController.deleteRoutine);

// Start a workout from a routine
router.post('/:id/start-workout', authenticate, routineController.startWorkoutFromRoutine);

module.exports = router;
