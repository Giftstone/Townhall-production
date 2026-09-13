const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const router = express.Router();
router.use(authenticateToken);

const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const reportSelect = `
  SELECT
    r.id, r.title, r.description, r.category, r.status,
    r.location, r.latitude, r.longitude, r.image_url,
    r.created_at, r.updated_at,
    r.user_id, r.assigned_to,
    reporter.name AS reporter_name,
    assignee.name AS assignee_name
  FROM reports r
  LEFT JOIN users reporter ON reporter.id = r.user_id
  LEFT JOIN users assignee ON assignee.id = r.assigned_to
`;

// Ensure column exists (safe for older DBs)
async function ensureImageColumn() {
  try {
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS image_url TEXT');
  } catch (err) {
    console.warn('image_url column ensure:', err.message);
  }
}
ensureImageColumn();

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`${reportSelect} ORDER BY r.created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    // Fallback if image_url missing mid-deploy
    if (err.code === '42703') {
      try {
        const result = await pool.query(
          `SELECT r.id, r.title, r.description, r.category, r.status,
                  r.location, r.latitude, r.longitude,
                  r.created_at, r.updated_at, r.user_id, r.assigned_to,
                  reporter.name AS reporter_name, assignee.name AS assignee_name
           FROM reports r
           LEFT JOIN users reporter ON reporter.id = r.user_id
           LEFT JOIN users assignee ON assignee.id = r.assigned_to
           ORDER BY r.created_at DESC`
        );
        return res.json(result.rows);
      } catch (e2) {
        console.error(e2);
      }
    }
    console.error('List reports error:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`${reportSelect} WHERE r.id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get report error:', err);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

async function insertReport({ title, description, category, location, latitude, longitude, userId, imageUrl }) {
  try {
    const result = await pool.query(
      `INSERT INTO reports
         (title, description, category, status, location, latitude, longitude, user_id, image_url)
       VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8)
       RETURNING *`,
      [title, description, category, location || null, latitude || null, longitude || null, userId, imageUrl || null]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '42703') {
      const result = await pool.query(
        `INSERT INTO reports
           (title, description, category, status, location, latitude, longitude, user_id)
         VALUES ($1,$2,$3,'pending',$4,$5,$6,$7)
         RETURNING *`,
        [title, description, category, location || null, latitude || null, longitude || null, userId]
      );
      return result.rows[0];
    }
    throw err;
  }
}

// Optional image: multipart field name "image"
router.post('/', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      // Support JSON body (no file) and multipart fields
      const body = req.body || {};
      const title = body.title;
      const description = body.description;
      const category = body.category;
      const location = body.location;
      const latitude = body.latitude !== undefined && body.latitude !== '' ? Number(body.latitude) : null;
      const longitude = body.longitude !== undefined && body.longitude !== '' ? Number(body.longitude) : null;

      if (!title || !description || !category) {
        if (req.file) {
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(400).json({ error: 'Title, description and category are required' });
      }

      const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
      const row = await insertReport({
        title,
        description,
        category,
        location,
        latitude,
        longitude,
        userId: req.user.id,
        imageUrl,
      });
      res.status(201).json(row);
    } catch (e) {
      console.error('Create report error:', e);
      res.status(500).json({ error: 'Failed to create report' });
    }
  });
});

router.patch(
  '/:id/status',
  authorize('responder', 'administrator'),
  async (req, res) => {
    const { status, assigned_to } = req.body;
    const allowed = ['pending', 'assigned', 'in_progress', 'resolved'];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    try {
      const result = await pool.query(
        `UPDATE reports
         SET status = COALESCE($1, status),
             assigned_to = COALESCE($2, assigned_to),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [status || null, assigned_to || req.user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Update report error:', err);
      res.status(500).json({ error: 'Failed to update report' });
    }
  }
);

module.exports = router;
