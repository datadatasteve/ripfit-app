// backend/src/routes/injuryRoutes.js (Phase 1A-2)
const express = require('express');
const router = express.Router();
const ic = require('../controllers/injuryController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
router.get('/',                 ic.listInjuries);
router.post('/',                ic.createInjury);
router.get('/:id',              ic.getInjury);
router.put('/:id',              ic.updateInjury);
router.delete('/:id',           ic.deleteInjury);
router.post('/:id/resolve',     ic.resolveInjury);
router.put('/:id/suggestion',   ic.answerSuggestion);

module.exports = router;
