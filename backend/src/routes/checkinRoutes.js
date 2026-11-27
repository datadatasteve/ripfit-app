// backend/src/routes/checkinRoutes.js (Phase 1A-2)
const express = require('express');
const router = express.Router();
const cc = require('../controllers/checkinController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
// Readiness check-in settings (per workout values live under /workouts/:id/readiness)
router.get('/readiness/setting',       cc.getReadinessSetting);
router.put('/readiness/default',       cc.setReadinessDefault);
router.put('/readiness/program/:id',   cc.setProgramReadiness);
router.put('/readiness/routine/:id',   cc.setRoutineReadiness);
// Daily check-in
router.get('/items',          cc.listItems);
router.post('/items',         cc.createItem);
router.put('/items/:id',      cc.updateItem);
router.delete('/items/:id',   cc.deleteItem);
router.get('/daily',          cc.listDays);
router.get('/daily/:date',    cc.getDay);
router.put('/daily/:date',    cc.putDay);

module.exports = router;
