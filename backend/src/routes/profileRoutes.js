// backend/src/routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getProfile, updateProfile, updateProfilePicture, removeProfilePicture,
  updatePassword, verifyEmail, resendVerification, adminVerifyUser,
  updatePreferences, listTempoTemplates, createTempoTemplate, deleteTempoTemplate,
} = require('../controllers/profileController');

// Email verification — no auth required (user clicks link from email)
router.get('/verify', verifyEmail);

// Admin backdoor — no JWT auth, protected by ADMIN_SECRET in body
router.post('/admin/verify-user', adminVerifyUser);

// All routes below require a valid JWT
router.use(auth);

router.get('/me', getProfile);
router.put('/me', updateProfile);
router.put('/me/picture', updateProfilePicture);
router.delete('/me/picture', removeProfilePicture);
router.put('/me/password', updatePassword);
router.post('/me/resend-verification', resendVerification);
router.put('/me/preferences', updatePreferences);
router.get('/me/tempo-templates', listTempoTemplates);
router.post('/me/tempo-templates', createTempoTemplate);
router.delete('/me/tempo-templates/:id', deleteTempoTemplate);

module.exports = router;
