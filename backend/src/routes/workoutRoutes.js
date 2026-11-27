const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const authenticate = require('../middleware/auth');

// Exercise search, browse, and lookup
router.get('/exercises/search', workoutController.searchExercises);
router.get('/exercises/browse', workoutController.browseExercises);
router.get('/exercises/:id', workoutController.getExerciseById);

// Exercise aliases and default names (Phase 1A-1)
const ac = require('../controllers/exerciseAliasController');
router.get('/exercises/:id/aliases', authenticate, ac.listAliases);
router.post('/exercises/:id/aliases', authenticate, ac.addUserAlias);
router.delete('/exercises/aliases/:aliasId', authenticate, ac.deleteUserAlias);
router.put('/exercises/:id/default-name', authenticate, ac.setDefaultName);
router.delete('/exercises/:id/default-name', authenticate, ac.clearDefaultName);

// Edit audit trail and soft delete (Phase 1A-2)
const ec = require('../controllers/editController');
router.get('/deleted', authenticate, ec.listDeleted);
router.patch('/sets/:id/edit', authenticate, ec.editSet);
router.delete('/sets/:id', authenticate, ec.deleteSet);
router.post('/sets/:id/restore', authenticate, ec.restoreSet);
router.patch('/cardio-segments/:id', authenticate, ec.editSegment);
router.delete('/cardio-segments/:id', authenticate, ec.deleteSegment);
router.post('/cardio-segments/:id/restore', authenticate, ec.restoreSegment);
router.patch('/:workoutId/edit', authenticate, ec.editWorkout);
router.delete('/:workoutId', authenticate, ec.deleteWorkout);
router.post('/:workoutId/restore', authenticate, ec.restoreWorkout);
router.get('/:workoutId/edits', authenticate, ec.listEdits);

// History — must come before /:workoutId routes
router.get('/history', authenticate, workoutController.getCombinedHistory);
router.get('/history/:id', authenticate, workoutController.getWorkoutDetail);

// Open session / Quick Cardio start — must come before /:workoutId routes
router.post('/start-free', authenticate, workoutController.startFreeLift);

// Last session's notes for one exercise — must come before /:workoutId routes
router.get('/previous-notes', authenticate, workoutController.getPreviousExerciseNotes);

// Session recovery (Phase 0A-2). Declared before the /:workoutId routes.
router.get('/active', authenticate, workoutController.getActiveWorkout);
router.get('/attention', authenticate, workoutController.getAttentionWorkouts);

// User-submitted exercise issue report
router.post('/exercises/:id/report', authenticate, workoutController.reportExercise);

// Timer blocks: attach a typed exercise name, creating it if it doesn't exist
router.post('/exercises/find-or-create', authenticate, workoutController.findOrCreateExercise);

// Workout logging
router.post('/', authenticate, workoutController.logWorkout);
router.get('/', authenticate, workoutController.getWorkouts);

// Readiness check-in (Phase 1A-2)
const ckc = require('../controllers/checkinController');
router.get('/:workoutId/readiness', authenticate, ckc.getWorkoutReadiness);
router.put('/:workoutId/readiness', authenticate, ckc.putWorkoutReadiness);

router.post('/:workoutId/sets', authenticate, workoutController.logWorkoutSet);
router.patch('/sets/:setId', authenticate, workoutController.updateWorkoutSet);
router.put('/:workoutId/finish', authenticate, workoutController.finishWorkout);
router.put('/:workoutId/cancel', authenticate, workoutController.cancelWorkout);
router.put('/:workoutId/notes', authenticate, workoutController.updateWorkoutNotes);
router.put('/:workoutId/type', authenticate, workoutController.updateWorkoutType);
router.put('/:workoutId/pause', authenticate, workoutController.pauseWorkout);
router.put('/:workoutId/resume', authenticate, workoutController.resumeWorkout);
router.put('/:workoutId/reopen', authenticate, workoutController.reopenWorkout);
router.put('/:workoutId/exercises/order', authenticate, workoutController.reorderWorkoutExercises);

router.post('/:workoutId/exercises', authenticate, workoutController.addExerciseToWorkout);
router.put('/:workoutId/exercises/:exerciseId/targets', authenticate, workoutController.updateExerciseTargets);
router.delete('/:workoutId/exercises/:exerciseId', authenticate, workoutController.deleteExerciseFromWorkout);
router.put('/:workoutId/exercises/:exerciseId/notes', authenticate, workoutController.updateExerciseNotes);
router.post('/:workoutId/exercises/:exerciseId/cardio-segments', authenticate, workoutController.logCardioSegment);
router.get('/:workoutId/exercises/:exerciseId/cardio-segments', authenticate, workoutController.getCardioSegments);

module.exports = router;
