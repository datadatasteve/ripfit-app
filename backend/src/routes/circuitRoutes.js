// backend/src/routes/circuitRoutes.js (Phase 1A-1)
const express = require('express');
const router = express.Router();
const cc = require('../controllers/circuitController');
const authenticate = require('../middleware/auth');

router.use(authenticate);

router.get('/',                      cc.listCircuits);
router.post('/',                     cc.createCircuit);
router.get('/:id',                   cc.getCircuit);
router.put('/:id',                   cc.updateCircuit);
router.delete('/:id',                cc.deleteCircuit);
router.post('/:id/complete',         cc.completeCircuit);
router.put('/:id/rounds/:round',     cc.logRound);
router.delete('/:id/rounds/:round',  cc.deleteRound);

module.exports = router;
