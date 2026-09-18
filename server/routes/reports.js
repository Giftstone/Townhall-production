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
// Official government-style PDF with map/location card, evidence images, responses
router.get('/:id/pdf', async (req, res) => {
  const https = require('https');
  const http = require('http');
  const PDFDocument = require('pdfkit');

  const fetchBuffer = (url, timeoutMs = 10000, redirects = 0) =>
    new Promise((resolve, reject) => {
      try {
        const lib = url.startsWith('https') ? https : http;
        const reqNet = lib.get(
          url,
          {
            timeout: timeoutMs,
            headers: {
              'User-Agent': 'TownhallPDF/1.0 (civic-report)',
              Accept: 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
            },
          },
          (resp) => {
            if (
              resp.statusCode >= 300 &&
              resp.statusCode < 400 &&
              resp.headers.location &&
              redirects < 4
            ) {
              resp.resume();
              const next = resp.headers.location.startsWith('http')
                ? resp.headers.location
                : new URL(resp.headers.location, url).toString();
              return resolve(fetchBuffer(next, timeoutMs, redirects + 1));
            }
            if (resp.statusCode && resp.statusCode >= 400) {
              resp.resume();
              return reject(new Error(`HTTP ${resp.statusCode}`));
            }
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => resolve(Buffer.concat(chunks)));
          }
        );
        reqNet.on('error', reject);
        reqNet.on('timeout', () => {
          reqNet.destroy();
          reject(new Error('timeout'));
        });
      } catch (e) {
        reject(e);
      }
    });

  const fetchMapSnapshot = async (lat, lng) => {
    const candidates = [
      `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=14&size=640x320&maptype=mapnik&markers=${lat},${lng},red-pushpin`,
      `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=600x280&markers=${lat},${lng},red-pushpin`,
    ];
    for (const url of candidates) {
      try {
        const buf = await fetchBuffer(url);
        if (buf && buf.length > 2000) {
          const isPng = buf[0] === 0x89 && buf[1] === 0x50;
          const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
          if (isPng || isJpg) return buf;
        }
      } catch (e) {
        console.warn('[reports PDF] map candidate failed:', e.message);
      }
    }
    return null;
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(d);
    }
  };

  const statusLabel = (s) => {
    const map = {
      pending: 'PENDING',
      assigned: 'ASSIGNED',
      in_progress: 'IN PROGRESS',
      resolved: 'RESOLVED',
    };
    return map[s] || String(s || 'UNKNOWN').toUpperCase();
  };

  try {
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

    const refNo = `TH/${String(report.category || 'GEN')
      .slice(0, 4)
      .toUpperCase()}/${String(report.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const filename = `Townhall-Official-Report-${String(report.id).slice(0, 8)}.pdf`;

    // Resolve local evidence images
    const imagePaths = [];
    const urls =
      Array.isArray(report.image_urls) && report.image_urls.length
        ? report.image_urls
        : report.image_url
          ? [report.image_url]
          : [];
    for (const u of urls) {
      if (!u) continue;
      const base = path.basename(String(u));
      const candidates = [
        path.join(uploadDir, base),
        path.join(__dirname, '..', 'uploads', base),
        path.join(__dirname, '..', String(u).replace(/^\//, '')),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          imagePaths.push(c);
          break;
        }
      }
    }

    const lat = report.latitude != null ? Number(report.latitude) : null;
    const lng = report.longitude != null ? Number(report.longitude) : null;
    let mapBuffer = null;
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      try {
        mapBuffer = await fetchMapSnapshot(lat, lng);
      } catch (e) {
        console.warn('[reports PDF] map snapshot failed:', e.message);
      }
    }

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 60, left: 50, right: 50 },
      bufferPages: true,
      info: {
        Title: `Official Incident Report — ${report.title || refNo}`,
        Author: 'Townhall Participatory Governance Platform',
        Subject: 'Official civic incident report',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Ensure we never write into the footer band
    const ensureSpace = (needed = 80) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
    };

    const hr = (color = '#1B4D3E', width = 1.2) => {
      doc
        .moveTo(left, doc.y)
        .lineTo(left + contentWidth, doc.y)
        .strokeColor(color)
        .lineWidth(width)
        .stroke();
      doc.moveDown(0.5);
    };

    const sectionTitle = (title) => {
      ensureSpace(40);
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B4D3E').text(title.toUpperCase());
      doc
        .moveTo(left, doc.y)
        .lineTo(left + 160, doc.y)
        .strokeColor('#1B4D3E')
        .lineWidth(0.9)
        .stroke();
      doc.moveDown(0.45);
      doc.font('Helvetica').fontSize(10).fillColor('#222222');
    };

    // ── Top accent bar ──────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 10).fill('#1B4D3E');
    doc.moveDown(1.2);

    // ── Letterhead ──────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B4D3E')
      .text('REPUBLIC OF ZAMBIA', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#333333')
      .text('LOCAL GOVERNMENT — CIVIC PARTICIPATION CHANNEL', { align: 'center' });
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1B2420')
      .text('TOWNHALL', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
      .text('Digital Participatory Governance Platform', { align: 'center' });
    doc.moveDown(0.35);
    hr('#1B4D3E', 1.5);

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1B2420')
      .text('OFFICIAL INCIDENT REPORT', { align: 'center' });
    doc.moveDown(0.5);

    // ── Document control ────────────────────────────────────────────────────
    const col2 = left + contentWidth / 2;
    const metaY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    doc.text(`Reference No.: ${refNo}`, left, metaY, { width: contentWidth / 2 - 8 });
    doc.text(`Date of Issue: ${formatDate(new Date())}`, col2, metaY, { width: contentWidth / 2 - 8 });
    doc.text(`Date Submitted: ${formatDate(report.created_at)}`, left, metaY + 14, {
      width: contentWidth / 2 - 8,
    });
    doc.text(`Status: ${statusLabel(report.status)}`, col2, metaY + 14, {
      width: contentWidth / 2 - 8,
    });
    doc.y = metaY + 34;
    hr('#C9C4B4', 0.6);

    // ── 1. Particulars ──────────────────────────────────────────────────────
    sectionTitle('1. Report Particulars');
    const line = (label, value) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222')
        .text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value || '—');
    };
    line('Title', report.title);
    line('Category', report.category);
    line('Location / Ward', report.location);
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      line('Coordinates', `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    }
    line('Reported by', report.reporter_name || 'Citizen');
    line(
      'Assigned officer',
      report.assignee_name
        ? `${report.assignee_name} (Ministry / Agency officer)`
        : 'Not yet assigned'
    );

    // ── 2. Description ──────────────────────────────────────────────────────
    sectionTitle('2. Description of the Incident');
    doc.font('Helvetica').fontSize(10).fillColor('#222222')
      .text(report.description || 'No description provided.', {
        align: 'justify',
        lineGap: 2,
      });

    // ── 3. Location snapshot ────────────────────────────────────────────────
    sectionTitle('3. Location Snapshot');
    if (mapBuffer) {
      try {
        ensureSpace(240);
        const mapW = Math.min(contentWidth, 480);
        const mapH = 210;
        const mapX = left + (contentWidth - mapW) / 2;
        const mapY = doc.y;
        doc.rect(mapX - 1, mapY - 1, mapW + 2, mapH + 2).strokeColor('#1B4D3E').lineWidth(0.8).stroke();
        doc.image(mapBuffer, mapX, mapY, { width: mapW, height: mapH });
        doc.y = mapY + mapH + 8;
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
          .text(
            `Map snapshot (OpenStreetMap) · ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            { align: 'center' }
          );
      } catch (e) {
        console.warn('[reports PDF] embed map failed:', e.message);
        mapBuffer = null; // fall through to card
      }
    }
    if (!mapBuffer && lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      ensureSpace(120);
      const cardH = 100;
      const y0 = doc.y;
      doc.roundedRect(left, y0, contentWidth, cardH, 5).fill('#F4F7F5');
      doc.roundedRect(left, y0, contentWidth, cardH, 5).strokeColor('#1B4D3E').lineWidth(1).stroke();
      doc.rect(left, y0, 5, cardH).fill('#1B4D3E');

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1B4D3E')
        .text('GEOGRAPHIC REFERENCE', left + 18, y0 + 14, { width: contentWidth - 36 });
      doc.font('Helvetica').fontSize(9).fillColor('#333333')
        .text(report.location || 'Location as recorded on the incident', left + 18, y0 + 32, {
          width: contentWidth - 36,
        });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1B2420')
        .text(`Latitude:   ${lat.toFixed(6)}`, left + 18, y0 + 52);
      doc.text(`Longitude:  ${lng.toFixed(6)}`, left + 18, y0 + 66);
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#666666')
        .text(
          'Live map tiles were unavailable at generation time. Coordinates above are authoritative.',
          left + 18,
          y0 + 82,
          { width: contentWidth - 36 }
        );
      doc.y = y0 + cardH + 10;
    } else if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text('No geographic coordinates were provided for this incident.');
    }

    // ── 4. Evidence ─────────────────────────────────────────────────────────
    sectionTitle('4. Supporting Evidence (Photographs)');
    if (imagePaths.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text('No photographic evidence was attached to this report.');
    } else {
      doc.font('Helvetica').fontSize(10).fillColor('#333333')
        .text(`${imagePaths.length} image(s) attached by the reporting citizen.`);
      doc.moveDown(0.35);

      const gap = 12;
      const imgW = (contentWidth - gap) / 2;
      const imgH = 150;
      let col = 0;
      let rowY = doc.y;

      for (let i = 0; i < imagePaths.length; i++) {
        if (rowY + imgH > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          rowY = doc.page.margins.top;
          col = 0;
        }
        const x = left + col * (imgW + gap);
        try {
          doc.image(imagePaths[i], x, rowY, { fit: [imgW, imgH], align: 'center', valign: 'center' });
        } catch (e) {
          doc.rect(x, rowY, imgW, imgH).strokeColor('#cccccc').stroke();
          doc.font('Helvetica').fontSize(8).fillColor('#999999')
            .text('Image unavailable', x + 8, rowY + imgH / 2 - 6, { width: imgW - 16 });
        }
        col += 1;
        if (col >= 2) {
          col = 0;
          rowY += imgH + 14;
        }
      }
      doc.y = col === 0 ? rowY : rowY + imgH + 10;
    }

    // ── 5. Official responses ───────────────────────────────────────────────
    sectionTitle('5. Official Response(s) by Assigned Officer');
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
      .text(
        'Official responses are posted only by the officer assigned to this incident ' +
          '(e.g. police officer, engineer, water & sanitation officer, district administration, ' +
          'or other authorised ministry staff).'
      );
    doc.moveDown(0.4);

    if (responses.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text('No official response has been recorded on this report to date.');
    } else {
      responses.forEach((r, idx) => {
        ensureSpace(70);
        const roleLabel =
          r.author_role === 'administrator'
            ? 'Administrator'
            : r.author_role === 'responder'
              ? 'Assigned Officer (Ministry / Agency)'
              : r.author_role || 'Officer';

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1B4D3E')
          .text(`Response ${idx + 1} — ${r.author_name || 'Officer'} · ${roleLabel}`);
        doc.font('Helvetica').fontSize(8).fillColor('#666666')
          .text(`Dated: ${formatDate(r.created_at)}`);
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(10).fillColor('#222222')
          .text(r.message || '—', { align: 'justify', lineGap: 2 });
        doc.moveDown(0.45);
      });
    }

    // ── 6. Certification ────────────────────────────────────────────────────
    ensureSpace(120);
    sectionTitle('6. Certification');
    doc.font('Helvetica').fontSize(9).fillColor('#222222')
      .text(
        'This document is generated from the Townhall digital participatory governance system. ' +
          'It reflects the incident particulars, geographic reference, citizen-submitted evidence, ' +
          'and any official responses recorded by the assigned officer at the time of generation.'
      );
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10).fillColor('#222222')
      .text('_________________________________');
    doc.text('Authorised Officer / System Record');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(9)
      .text(`Generated: ${formatDate(new Date())}`);
    doc.text(`Reference: ${refNo}`);

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = doc.page.height - 40;
      doc
        .moveTo(left, footerY - 8)
        .lineTo(left + contentWidth, footerY - 8)
        .strokeColor('#C9C4B4')
        .lineWidth(0.5)
        .stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#888888')
        .text(
          `Townhall · Official Incident Report · For official and citizen reference · Page ${i + 1} of ${range.count}`,
          left,
          footerY,
          { width: contentWidth, align: 'center', lineBreak: false }
        );
    }

    doc.end();
  } catch (err) {
    console.error('[reports PDF]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }
});

module.exports = router;