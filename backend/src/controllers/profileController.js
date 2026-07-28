// backend/src/controllers/profileController.js
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendVerificationEmail } = require('../utils/emailService');

// ── GET /users/me ──────────────────────────────────────────────────────────
// Returns the current user's profile. Never returns password_hash.
async function getProfile(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         id, username, email, display_name, profile_picture,
         height_cm, weight_kg, date_of_birth, gender,
         units_weight, units_distance, theme_preference, goals,
         email_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('getProfile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

// ── PUT /users/me ──────────────────────────────────────────────────────────
// Updates editable profile fields. Email change re-triggers verification.
async function updateProfile(req, res) {
  const {
    display_name, height_cm, weight_kg, date_of_birth, gender,
    units_weight, units_distance, theme_preference, goals, email
  } = req.body;

  try {
    // If email is changing, check it isn't already taken and queue re-verification.
    let emailChanged = false;
    let newVerifyToken = null;

    if (email) {
      const current = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
      if (current.rows[0].email !== email) {
        const taken = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
        if (taken.rows.length > 0) {
          return res.status(409).json({ error: 'Email already in use' });
        }
        emailChanged = true;
        newVerifyToken = crypto.randomUUID();
      }
    }

    const result = await pool.query(
      `UPDATE users SET
         display_name       = COALESCE($1, display_name),
         height_cm          = COALESCE($2, height_cm),
         weight_kg          = COALESCE($3, weight_kg),
         date_of_birth      = COALESCE($4, date_of_birth),
         gender             = COALESCE($5, gender),
         units_weight       = COALESCE($6, units_weight),
         units_distance     = COALESCE($7, units_distance),
         theme_preference   = COALESCE($8, theme_preference),
         goals              = COALESCE($9, goals),
         email              = COALESCE($10, email),
         email_verified     = CASE WHEN $10 IS NOT NULL AND $10 != email THEN FALSE ELSE email_verified END,
         email_verify_token = CASE WHEN $11 IS NOT NULL THEN $11 ELSE email_verify_token END,
         email_verify_sent_at = CASE WHEN $11 IS NOT NULL THEN NOW() ELSE email_verify_sent_at END
       WHERE id = $12
       RETURNING id, username, email, display_name, height_cm, weight_kg,
                 date_of_birth, gender, units_weight, units_distance,
                 theme_preference, goals, email_verified`,
      [
        display_name || null,
        height_cm || null,
        weight_kg || null,
        date_of_birth || null,
        gender || null,
        units_weight || null,
        units_distance || null,
        theme_preference || null,
        goals ? JSON.stringify(goals) : null,
        email || null,
        newVerifyToken,
        req.user.id
      ]
    );

    // Send new verification email if address changed
    if (emailChanged && newVerifyToken) {
      await sendVerificationEmail(email, newVerifyToken).catch(err => {
        console.error('Failed to send re-verification email:', err);
        // Don't block the response — profile was saved, email just didn't send
      });
    }

    res.json({
      ...result.rows[0],
      email_verification_sent: emailChanged
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
}

// ── PUT /users/me/picture ──────────────────────────────────────────────────
// Accepts a base64 image string. Enforces a ~2MB limit (base64 of 1.5MB file).
async function updateProfilePicture(req, res) {
  const { image } = req.body; // base64 string, data URI format: "data:image/jpeg;base64,..."

  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }

  // Rough size check — base64 is ~4/3 the original bytes.
  // 2MB base64 string ≈ 1.5MB image, which is plenty for a profile pic.
  const MAX_BASE64_BYTES = 2 * 1024 * 1024;
  if (Buffer.byteLength(image, 'utf8') > MAX_BASE64_BYTES) {
    return res.status(413).json({ error: 'Image too large. Maximum size is ~1.5MB.' });
  }

  // Validate it's actually an image data URI
  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid image format' });
  }

  try {
    await pool.query(
      'UPDATE users SET profile_picture = $1 WHERE id = $2',
      [image, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('updateProfilePicture error:', err);
    res.status(500).json({ error: 'Failed to save profile picture' });
  }
}

// ── PUT /users/me/password ─────────────────────────────────────────────────
async function updatePassword(req, res) {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }

  // Same password requirements as registration
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
  if (!passwordRegex.test(new_password)) {
    return res.status(400).json({
      error: 'New password must be at least 8 characters with uppercase, lowercase, number, and special character'
    });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    res.json({ ok: true, message: 'Password updated' });
  } catch (err) {
    console.error('updatePassword error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
}

// ── GET /users/verify?token=... ────────────────────────────────────────────
// Called when user clicks the link in their verification email.
async function verifyEmail(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Verification token required' });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = TRUE, email_verify_token = NULL
       WHERE email_verify_token = $1
       RETURNING id, email`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    // Redirect to the app with a success flag so the frontend can show a toast
    res.redirect(`${process.env.APP_URL || 'https://datadatasteve.github.io/ripfit-app'}?verified=true`);
  } catch (err) {
    console.error('verifyEmail error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// ── POST /users/resend-verification ───────────────────────────────────────
// Lets an unverified user request a new verification email.
async function resendVerification(req, res) {
  try {
    const user = await pool.query(
      'SELECT email, email_verified, email_verify_sent_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (user.rows[0].email_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Rate limit: don't resend more than once per minute
    const lastSent = user.rows[0].email_verify_sent_at;
    if (lastSent && (Date.now() - new Date(lastSent).getTime()) < 60_000) {
      return res.status(429).json({ error: 'Please wait before requesting another verification email' });
    }

    const token = crypto.randomUUID();
    await pool.query(
      `UPDATE users SET email_verify_token = $1, email_verify_sent_at = NOW() WHERE id = $2`,
      [token, req.user.id]
    );

    await sendVerificationEmail(user.rows[0].email, token);
    res.json({ ok: true });
  } catch (err) {
    console.error('resendVerification error:', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
}

// ── POST /admin/verify-user ────────────────────────────────────────────────
// Dev/admin backdoor: manually verify any user by email.
// Protected by ADMIN_SECRET env var — not exposed to the frontend.
async function adminVerifyUser(req, res) {
  const { email, secret } = req.body;

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET email_verified = TRUE, email_verify_token = NULL
       WHERE email = $1 RETURNING id, email`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error('adminVerifyUser error:', err);
    res.status(500).json({ error: 'Failed to verify user' });
  }
}

module.exports = {
  getProfile, updateProfile, updateProfilePicture,
  updatePassword, verifyEmail, resendVerification, adminVerifyUser
};
