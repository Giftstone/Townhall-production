// server/routes/auth.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  getFrontendBase,
} = require('../services/notifier');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev_refresh_secret';

// REGISTER — always citizen
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const role = 'citizen';

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, hashedPassword, role]
    );
    const user = result.rows[0];
    sendWelcomeEmail(user.email, user.name);
    res.status(201).json({ message: 'User created', user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const refreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: '30d' });

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [
      refreshToken,
      user.id,
    ]);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// REFRESH
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND refresh_token = $2',
      [decoded.id, refreshToken]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const user = result.rows[0];
    const newAccessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const newRefreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: '30d' });
    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [
      newRefreshToken,
      user.id,
    ]);

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
});

// ME
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [decoded.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns a generic success message (no account enumeration).
 * In non-production, also returns debug: { resetLink, code, previewUrl, mailError }
 */
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const generic = {
    message:
      'If an account exists for that email, a reset code and link have been sent.',
  };

  try {
    const result = await pool.query('SELECT id, name, email FROM users WHERE lower(email) = $1', [
      email,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.json(generic);
    }

    const code = String(crypto.randomInt(100000, 999999));
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store hashed token; plain code is also acceptable as short OTP stored hashed
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    // Store "tokenHash:codeHash" so either link token or email code works
    await pool.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires = $2
       WHERE id = $3`,
      [`${tokenHash}:${codeHash}`, expires, user.id]
    );

    const base = getFrontendBase();
    const resetLink = `${base}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

    const mailResult = await sendPasswordResetEmail(user.email, user.name, {
      resetLink,
      code,
    });

    const payload = { ...generic };

    // Help local testing when real SMTP is not configured
    if (process.env.NODE_ENV !== 'production') {
      payload.debug = {
        resetLink,
        code,
        previewUrl: mailResult.previewUrl,
        mailOk: mailResult.ok,
        mailMode: mailResult.mailMode,
        mailError: mailResult.error || null,
        hint: mailResult.ok
          ? mailResult.previewUrl
            ? 'Open previewUrl in a browser to read the email (Ethereal).'
            : 'Email accepted by SMTP.'
          : 'Email send failed — use resetLink/code from this debug payload, and check server logs.',
      };
      console.log('🔑 Password reset (dev):', {
        email: user.email,
        code,
        resetLink,
        previewUrl: mailResult.previewUrl,
        mailOk: mailResult.ok,
      });
    }

    res.json(payload);
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Could not process password reset' });
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { email, token?, code?, password }
 * Accepts either the long link token or the 6-digit email code.
 */
router.post('/reset-password', async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = req.body.password;
  const token = req.body.token ? String(req.body.token) : '';
  const code = req.body.code ? String(req.body.code).trim() : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and new password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!token && !code) {
    return res.status(400).json({ error: 'Reset token or code is required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, reset_token, reset_token_expires FROM users WHERE lower(email) = $1',
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.reset_token) {
      return res.status(400).json({ error: 'Invalid or expired reset request' });
    }
    if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired. Request a new one.' });
    }

    const [storedTokenHash, storedCodeHash] = String(user.reset_token).split(':');
    let ok = false;
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      ok = storedTokenHash && tokenHash === storedTokenHash;
    }
    if (!ok && code) {
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      ok = storedCodeHash && codeHash === storedCodeHash;
    }
    if (!ok) {
      return res.status(400).json({ error: 'Invalid reset token or code' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token = NULL,
           reset_token_expires = NULL,
           refresh_token = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password updated. You can sign in with your new password.' });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

/**
 * POST /api/auth/change-password  (logged-in)
 * Body: { currentPassword, newPassword }
 */
router.post('/change-password', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Could not change password' });
  }
});

module.exports = router;
