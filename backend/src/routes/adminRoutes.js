// backend/src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  listUsers, getUser, updateUser,
  listBugReports, updateBugReport,
  listErrorLogs, resolveErrorLog,
  logClientError, submitBugReport,
  listExercises, createExercise, updateExercise, deleteExercise,
  listExerciseReports, resolveExerciseReport,
} = require('../controllers/adminController');

// ── No auth required ───────────────────────────────────────────────────────
// Client error logging — called from ErrorBoundary even before login
// Separate rate limit to prevent abuse
const rateLimit = require('express-rate-limit');
const errorLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 20,              // max 20 error reports per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});
router.post('/errors', errorLimiter, logClientError);

// ── Auth required ──────────────────────────────────────────────────────────
router.use(auth);

// User-facing: submit a bug report
router.post('/bug-reports', submitBugReport);

// Admin-only (guard enforced inside each controller function)
router.get('/users',                      listUsers);
router.get('/users/:id',                  getUser);
router.put('/users/:id',                  updateUser);
router.get('/bug-reports',                listBugReports);
router.put('/bug-reports/:id',            updateBugReport);
router.get('/error-logs',                 listErrorLogs);
router.put('/error-logs/:id/resolve',     resolveErrorLog);

// Exercise Manager
router.get('/exercises',                    listExercises);
router.post('/exercises',                   createExercise);
router.put('/exercises/:id',                updateExercise);
router.delete('/exercises/:id',             deleteExercise);
router.get('/exercise-reports',             listExerciseReports);
router.put('/exercise-reports/:id/resolve', resolveExerciseReport);

module.exports = router;
