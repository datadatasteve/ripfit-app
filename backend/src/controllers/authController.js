// backend/src/controllers/authController.js
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail } = require('../utils/emailService');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '30d';

// Password must be 8+ chars with upper, lower, number, and special character.
// Same regex enforced on frontend in Login.jsx.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

async function register(req, res) {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character'
    });
  }

  try {
    // Check for existing username or email
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomUUID();

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verify_token, email_verify_sent_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, username, email`,
      [username, email, passwordHash, verifyToken]
    );

    const user = result.rows[0];

    // Send verification email — don't block registration if it fails
    sendVerificationEmail(email, verifyToken).catch(err => {
      console.error('Failed to send verification email on register:', err);
    });

    // Issue JWT so they can call /me/resend-verification if needed,
    // but they'll be blocked from the main app until verified.
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
      email_verification_sent: true,
      message: 'Account created. Check your email to verify your account before logging in.'
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, email_verified FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Block unverified users with a specific error code the frontend can act on
    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please check your email and click the verification link before logging in.'
      });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

module.exports = { register, login };

