// backend/src/routes/calendarRoutes.js (Phase 1A-1): public .ics feed by secret token.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getFeed } = require('../controllers/calendarController');

// Its own limit on top of the general /api/v1 one: calendar apps poll a few
// times an hour, so this only stops someone hammering or guessing tokens.
const feedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/feed/:file', feedLimiter, getFeed);

module.exports = router;
