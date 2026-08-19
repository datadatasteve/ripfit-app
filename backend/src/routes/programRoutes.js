// backend/src/routes/programRoutes.js
const express = require('express');
const router = express.Router();
const pc = require('../controllers/programController');
const authenticate = require('../middleware/auth');

router.use(authenticate);

// Programs CRUD
router.get('/',           pc.getPrograms);
router.post('/',          pc.createProgram);
router.get('/active',     pc.getActivePrograms);
router.get('/:id',        pc.getProgramById);
router.put('/:id',        pc.updateProgram);
router.delete('/:id',     pc.deleteProgram);
router.put('/:id/activate', pc.activateProgram);

// Program workouts
router.post('/:programId/days/:programRoutineId/start',    pc.startProgramWorkout);
router.post('/:programId/days/:programRoutineId/complete', pc.completeProgramWorkout);

// Progress + stats
router.get('/:id/progress', pc.getProgramProgress);
router.get('/:id/stats',    pc.getProgramStats);

// Journal
router.post('/:id/journal',          pc.addJournalEntry);
router.put('/journal/:entryId',      pc.updateJournalEntry);
router.delete('/journal/:entryId',   pc.deleteJournalEntry);

module.exports = router;
