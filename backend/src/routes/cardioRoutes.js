// ============================================================================
// Cardio Routes
// ============================================================================
const express = require('express');
const router = express.Router();
const cardioController = require('../controllers/cardioController');
const authenticate = require('../middleware/auth');

router.get('/types', cardioController.getCardioTypes);
router.get('/history', authenticate, cardioController.getHistory);
router.post('/start', authenticate, cardioController.startSession);
router.put('/:id/notes', authenticate, cardioController.updateNotes);
router.put('/:id/finish', authenticate, cardioController.finishSession);
router.put('/:id/cancel', authenticate, cardioController.cancelSession);

module.exports = router;
