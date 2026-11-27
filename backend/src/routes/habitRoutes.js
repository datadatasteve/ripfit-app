// backend/src/routes/habitRoutes.js (Phase 1A-2)
const express = require('express');
const router = express.Router();
const hc = require('../controllers/habitController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
router.get('/',                    hc.listHabits);
router.post('/',                   hc.createHabit);
router.get('/:id',                 hc.getHabit);
router.put('/:id',                 hc.updateHabit);
router.delete('/:id',              hc.deleteHabit);
router.get('/:id/logs',            hc.listLogs);
router.put('/:id/logs/:date',      hc.putLog);
router.delete('/:id/logs/:date',   hc.deleteLog);

module.exports = router;
