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
  limits: { fileSize: 5 * 1024 * 1024 },
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
    r.location, r.latitude, r.longitude, r.image_url, r.image_urls,
    r.created_at, r.updated_at,
    r.user_id, r.assigned_to,
    reporter.name AS reporter_name,
    assignee.name AS assignee_name
  FROM reports r
  LEFT JOIN users reporter ON reporter.id = r.user_id
  LEFT JOIN users assignee ON assignee.id = r.assigned_to
`;

async function ensureImageColumns() {
  try {
    await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS image_url TEXT');
    await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'");
  } catch (err) {
    console.warn('image column ensure:', err.message);
  }
}
ensureImageColumns();

router.get('/', async (req, res) => {
  try {
    // Responders only see reports for their ward (location match, assigned to them/their ward colleagues, or filed by ward users)
    if (req.user?.role === 'responder') {
      const me = await pool.query(
        `SELECT u.ward_id, w.name AS ward_name
         FROM users u
         LEFT JOIN wards w ON w.id = u.ward_id
         WHERE u.id = $1`,
        [req.user.id]
      );
      const wardId = me.rows[0]?.ward_id || null;
      const wardName = me.rows[0]?.ward_name || '';

      if (!wardId) {
        // No ward assigned — only show reports explicitly assigned to this responder
        const result = await pool.query(
          `${reportSelect} WHERE r.assigned_to = $1 ORDER BY r.created_at DESC`,
          [req.user.id]
        );
        return res.json(result.rows);
      }

      const result = await pool.query(
        `${reportSelect}
         WHERE (
           LOWER(TRIM(COALESCE(r.location, ''))) = LOWER(TRIM($2::text))
           OR r.assigned_to = $1
           OR r.assigned_to IN (SELECT id FROM users WHERE ward_id = $3 AND role = 'responder')
           OR r.user_id IN (SELECT id FROM users WHERE ward_id = $3)
         )
         ORDER BY r.created_at DESC`,
        [req.user.id, wardName, wardId]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(`${reportSelect} ORDER BY r.created_at DESC`);
    res.json(result.rows);
  } catch (err) {
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

// Multi-image POST (up to 10 images via field name "images")
router.post('/', (req, res) => {
  upload.fields([{ name: 'images', maxCount: 10 }, { name: 'image', maxCount: 1 }])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });

    try {
      const body = req.body || {};
      const { title, description, category, location } = body;
      const latitude  = body.latitude  !== undefined && body.latitude  !== '' ? Number(body.latitude)  : null;
      const longitude = body.longitude !== undefined && body.longitude !== '' ? Number(body.longitude) : null;

      if (!title || !description || !category) {
        const files = [...(req.files?.images || []), ...(req.files?.image || [])];
        files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
        return res.status(400).json({ error: 'Title, description and category are required' });
      }

      // Collect all uploaded image paths
      const allFiles = [...(req.files?.images || []), ...(req.files?.image || [])];
      const imageUrls = allFiles.map(f => `/uploads/${f.filename}`);
      const imageUrl  = imageUrls[0] || null; // keep legacy single field

      const result = await pool.query(
        `INSERT INTO reports
           (title, description, category, status, location, latitude, longitude, user_id, image_url, image_urls)
         VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [title, description, category, location || null, latitude, longitude, req.user.id, imageUrl, imageUrls]
      );

      res.status(201).json(result.rows[0]);
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

// ─── GET /api/reports/:id/pdf ────────────────────────────────────────────────
// Citizen (or any authenticated user) can download the report + official responses as PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const reportId = req.params.id;

    const reportResult = await pool.query(
      `${reportSelect} WHERE r.id = $1`,
      [reportId]
    );
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const report = reportResult.rows[0];

    const responsesResult = await pool.query(
      `SELECT rr.message, rr.created_at, u.name AS author_name, u.role AS author_role
       FROM report_responses rr
       JOIN users u ON u.id = rr.user_id
       WHERE rr.report_id = $1
       ORDER BY rr.created_at ASC`,
      [reportId]
    );
    const responses = responsesResult.rows;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `Townhall-Report-${String(report.id).slice(0, 8)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).fillColor('#1B2420').text('TOWNHALL', { continued: false });
    doc.fontSize(11).fillColor('#555555').text('Digital Participatory Governance Platform');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#3B5D3A');
    doc.moveDown();

    // Report title
    doc.fontSize(16).fillColor('#1B2420').text(report.title || 'Untitled Report');
    doc.moveDown(0.4);

    // Meta
    doc.fontSize(10).fillColor('#333333');
    doc.text(`Category: ${report.category || '—'}`);
    doc.text(`Status: ${report.status || '—'}`);
    doc.text(`Location: ${report.location || '—'}`);
    if (report.latitude != null && report.longitude != null) {
      doc.text(`Coordinates: ${report.latitude}, ${report.longitude}`);
    }
    doc.text(`Reporter: ${report.reporter_name || '—'}`);
    doc.text(`Assigned to: ${report.assignee_name || 'Unassigned'}`);
    doc.text(`Submitted: ${report.created_at ? new Date(report.created_at).toLocaleString() : '—'}`);
    doc.moveDown();

    // Description
    doc.fontSize(12).fillColor('#1B2420').text('Description');
    doc.fontSize(10).fillColor('#333333').text(report.description || 'No description provided.', {
      align: 'left',
    });
    doc.moveDown();

    // Official responses
    doc.fontSize(12).fillColor('#1B2420').text('Official Responses');
    doc.moveDown(0.3);

    if (responses.length === 0) {
      doc.fontSize(10).fillColor('#666666').text('No official responses have been posted yet.');
    } else {
      responses.forEach((r, idx) => {
        doc.fontSize(10).fillColor('#3B5D3A')
          .text(`${idx + 1}. ${r.author_name || 'Official'} (${r.author_role || 'responder'}) — ${r.created_at ? new Date(r.created_at).toLocaleString() : ''}`);
        doc.fontSize(10).fillColor('#333333').text(r.message || '', { indent: 10 });
        doc.moveDown(0.4);
      });
    }

    doc.moveDown();
    doc.fontSize(8).fillColor('#888888')
      .text(`Generated by Townhall on ${new Date().toLocaleString()}`, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[reports PDF]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }
});

module.exports = router;