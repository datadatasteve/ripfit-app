// backend/src/routes/reviewRoutes.js (Phase 1A-2)
const express = require('express');
const router = express.Router();
const rc = require('../controllers/reviewController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
router.get('/daily',  rc.getDaily);
router.get('/weekly', rc.getWeekly);

module.exports = router;
