// backend/src/routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getOverview, getStrengthStats, getCardioStats,
  getRecords, getCombinedStats, getExerciseStats,
  rateWorkout, updateRatingPrefs, adminResetPassword,
} = require('../controllers/statsController');

// Admin — no JWT, protected by ADMIN_SECRET in body
router.post('/admin/reset-password', adminResetPassword);

// All routes below require auth
router.use(auth);

// Stats endpoints
router.get('/overview',          getOverview);
router.get('/strength',          getStrengthStats);
router.get('/cardio',            getCardioStats);
router.get('/records',           getRecords);
router.get('/combined',          getCombinedStats);
router.get('/exercise/:id',      getExerciseStats);

// Rating
router.put('/workouts/:id/rating',    rateWorkout);
router.put('/users/me/rating-prefs',  updateRatingPrefs);

module.exports = router;
