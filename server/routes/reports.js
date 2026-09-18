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
// Official-style PDF: report details, map snapshot, evidence images, official responses
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
              'User-Agent': 'TownhallPDF/1.0 (civic-report; +https://virtual-townhall.vercel.app)',
              Accept: 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
            },
          },
          (resp) => {
            // Follow redirects (common for static map CDNs)
            if (
              resp.statusCode &&
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

  /** Try several free static-map endpoints; return first usable image buffer. */
  const fetchMapSnapshot = async (lat, lng) => {
    const candidates = [
      // OpenStreetMap.de static maps
      `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=14&size=640x320&maptype=mapnik&markers=${lat},${lng},red-pushpin`,
      // Alternative OSM static service
      `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=600x280&markers=${lat},${lng},red-pushpin`,
      // OpenStreetMap France static (sometimes reachable when .de is blocked)
      `https://staticmap.openstreetmap.fr/osmfr/?center=${lat},${lng}&zoom=14&width=640&height=320&markers=${lat},${lng}`,
    ];
    for (const url of candidates) {
      try {
        const buf = await fetchBuffer(url);
        // Basic sanity: non-trivial size and looks like an image (PNG/JPEG magic)
        if (buf && buf.length > 2000) {
          const isPng = buf[0] === 0x89 && buf[1] === 0x50;
          const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
          if (isPng || isJpg) return buf;
        }
      } catch (e) {
        console.warn('[reports PDF] map candidate failed:', url.slice(0, 60), e.message);
      }
    }
    return null;
  };

  /** Draw a formal location card when live map tiles are unavailable. */
  const drawLocationCard = (doc, left, width, lat, lng, locationName) => {
    const cardH = 110;
    const y0 = doc.y;
    doc.save();
    doc.roundedRect(left, y0, width, cardH, 6).fillAndStroke('#F4F7F5', '#1B4D3E');
    // Accent bar
    doc.rect(left, y0, 6, cardH).fill('#1B4D3E');
    // Pin glyph (simple circle + stem)
    const cx = left + 36;
    const cy = y0 + 42;
    doc.circle(cx, cy - 8, 10).fill('#C26A33');
    doc.circle(cx, cy - 8, 4).fill('#FFFFFF');
    doc
      .moveTo(cx, cy + 2)
      .lineTo(cx - 7, cy + 16)
      .lineTo(cx + 7, cy + 16)
      .fill('#C26A33');

    doc.fillColor('#1B2420').font('Helvetica-Bold').fontSize(10)
      .text('GEOGRAPHIC REFERENCE', left + 60, y0 + 14, { width: width - 80 });
    doc.font('Helvetica').fontSize(9).fillColor('#333333')
      .text(locationName || 'Location as recorded on the incident', left + 60, y0 + 32, {
        width: width - 80,
      });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1B4D3E')
      .text(`Latitude:  ${Number(lat).toFixed(6)}`, left + 60, y0 + 56);
    doc.text(`Longitude: ${Number(lng).toFixed(6)}`, left + 60, y0 + 72);
    doc.font('Helvetica-Oblique').fontSize(7).fillColor('#666666')
      .text(
        'Live map tiles were unavailable from the map service at generation time. Coordinates remain authoritative.',
        left + 60,
        y0 + 90,
        { width: width - 80 }
      );
    doc.restore();
    doc.y = y0 + cardH + 8;
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

    const refNo = `TH/${String(report.category || 'GEN').slice(0, 4).toUpperCase()}/${String(report.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const filename = `Townhall-Official-Report-${String(report.id).slice(0, 8)}.pdf`;

    // Collect image paths (local uploads)
    const imagePaths = [];
    const urls = Array.isArray(report.image_urls) && report.image_urls.length
      ? report.image_urls
      : report.image_url
        ? [report.image_url]
        : [];
    for (const u of urls) {
      if (!u) continue;
      const rel = String(u).replace(/^\//, '');
      const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, '..', rel.startsWith('uploads') ? rel : path.join('uploads', path.basename(rel)));
      // Also try direct uploads folder by basename
      const candidates = [
        abs,
        path.join(uploadDir, path.basename(String(u))),
        path.join(__dirname, '..', 'uploads', path.basename(String(u))),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          imagePaths.push(c);
          break;
        }
      }
    }

    // Static map snapshot (with multi-source fallback)
    let mapBuffer = null;
    const lat = report.latitude != null ? Number(report.latitude) : null;
    const lng = report.longitude != null ? Number(report.longitude) : null;
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      try {
        mapBuffer = await fetchMapSnapshot(lat, lng);
      } catch (e) {
        console.warn('[reports PDF] map snapshot failed:', e.message);
      }
    }

    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
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

    const pageWidth = doc.page.width;
    const left = 50;
    const right = pageWidth - 50;
    const contentWidth = right - left;

    // ── Letterhead ──────────────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, 8).fill('#1B4D3E');

    doc.fillColor('#1B4D3E')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('REPUBLIC OF ZAMBIA', left, 28, { align: 'center', width: contentWidth });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text('LOCAL GOVERNMENT — CIVIC PARTICIPATION CHANNEL', { align: 'center', width: contentWidth });

    doc.moveDown(0.25);
    doc.font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#1B2420')
      .text('TOWNHALL', { align: 'center', width: contentWidth });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text('Digital Participatory Governance Platform', { align: 'center', width: contentWidth });

    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#1B4D3E').lineWidth(1.5).stroke();
    doc.moveDown(0.6);

    // ── Document control block ──────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1B2420')
      .text('OFFICIAL INCIDENT REPORT', { align: 'center', width: contentWidth });
    doc.moveDown(0.5);

    const metaTop = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    doc.text(`Reference No.: ${refNo}`, left, metaTop);
    doc.text(`Date of Issue: ${formatDate(new Date())}`, left + 280, metaTop);
    doc.text(`Date Submitted: ${formatDate(report.created_at)}`, left, metaTop + 14);
    doc.text(`Status: ${statusLabel(report.status)}`, left + 280, metaTop + 14);
    doc.y = metaTop + 36;

    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#C9C4B4').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // ── Section 1: Particulars ───────────────────────────────────────────────
    const section = (title) => {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1B4D3E').text(title.toUpperCase());
      doc.moveTo(left, doc.y + 1).lineTo(left + 180, doc.y + 1).strokeColor('#1B4D3E').lineWidth(0.8).stroke();
      doc.moveDown(0.45);
      doc.font('Helvetica').fontSize(9).fillColor('#222222');
    };

    section('1. Report Particulars');
    doc.font('Helvetica-Bold').text('Title: ', { continued: true });
    doc.font('Helvetica').text(report.title || '—');
    doc.font('Helvetica-Bold').text('Category: ', { continued: true });
    doc.font('Helvetica').text(report.category || '—');
    doc.font('Helvetica-Bold').text('Location / Ward: ', { continued: true });
    doc.font('Helvetica').text(report.location || '—');
    if (lat != null && lng != null) {
      doc.font('Helvetica-Bold').text('Coordinates: ', { continued: true });
      doc.font('Helvetica').text(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    }
    doc.font('Helvetica-Bold').text('Reported by: ', { continued: true });
    doc.font('Helvetica').text(report.reporter_name || 'Citizen');
    doc.font('Helvetica-Bold').text('Assigned officer: ', { continued: true });
    doc.font('Helvetica').text(
      report.assignee_name
        ? `${report.assignee_name} (Ministry / Agency officer)`
        : 'Not yet assigned'
    );

    // ── Section 2: Narrative ─────────────────────────────────────────────────
    section('2. Description of the Incident');
    doc.font('Helvetica').fontSize(9).fillColor('#222222')
      .text(report.description || 'No description provided.', {
        align: 'justify',
        lineGap: 2,
      });

    // ── Section 3: Location map ──────────────────────────────────────────────
    section('3. Location Snapshot');
    if (mapBuffer && mapBuffer.length > 500) {
      try {
        const mapW = Math.min(contentWidth, 480);
        const mapH = 220;
        const mapX = left + (contentWidth - mapW) / 2;
        // border frame
        doc.rect(mapX - 1, doc.y - 1, mapW + 2, mapH + 2).strokeColor('#1B4D3E').lineWidth(0.8).stroke();
        doc.image(mapBuffer, mapX, doc.y, { width: mapW, height: mapH });
        doc.y += mapH + 8;
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
          .text(
            `Map snapshot (OpenStreetMap) · Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            { align: 'center', width: contentWidth }
          );
      } catch (e) {
        console.warn('[reports PDF] embed map failed:', e.message);
        drawLocationCard(doc, left, contentWidth, lat, lng, report.location);
      }
    } else if (lat != null && lng != null) {
      // Guaranteed visual when external map services are blocked (common on cloud hosts)
      drawLocationCard(doc, left, contentWidth, lat, lng, report.location);
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text('No geographic coordinates were provided for this incident.');
    }

    // ── Section 4: Evidence ──────────────────────────────────────────────────
    section('4. Supporting Evidence (Photographs)');
    if (imagePaths.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text('No photographic evidence was attached to this report.');
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#333333')
        .text(`${imagePaths.length} image(s) attached by the reporting citizen.`);
      doc.moveDown(0.3);

      const maxPerRow = 2;
      const gap = 12;
      const imgW = (contentWidth - gap) / maxPerRow;
      const imgH = 150;
      let col = 0;
      let rowY = doc.y;

      for (let i = 0; i < imagePaths.length; i++) {
        // New page if needed
        if (rowY + imgH > doc.page.height - 80) {
          doc.addPage();
          rowY = 50;
          col = 0;
        }
        const x = left + col * (imgW + gap);
        try {
          doc.image(imagePaths[i], x, rowY, {
            fit: [imgW, imgH],
            align: 'center',
            valign: 'center',
          });
        } catch (e) {
          doc.rect(x, rowY, imgW, imgH).stroke('#cccccc');
          doc.font('Helvetica').fontSize(8).fillColor('#999')
            .text('Image unavailable', x + 8, rowY + imgH / 2);
        }
        col += 1;
        if (col >= maxPerRow) {
          col = 0;
          rowY += imgH + 16;
        }
      }
      if (col !== 0) {
        doc.y = rowY + imgH + 10;
      } else {
        doc.y = rowY + 4;
      }
    }

    // ── Section 5: Official responses ────────────────────────────────────────
    // Ensure space
    if (doc.y > doc.page.height - 160) doc.addPage();

    section('5. Official Response(s) by Assigned Officer');
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
      .text(
        'Official responses are posted only by the officer assigned to this incident ' +
        '(e.g. police officer, engineer, water & sanitation officer, district administration, or other authorised ministry staff).'
      );
    doc.moveDown(0.4);

    if (responses.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text('No official response has been recorded on this report to date.');
    } else {
      responses.forEach((r, idx) => {
        if (doc.y > doc.page.height - 100) doc.addPage();
        const roleLabel =
          r.author_role === 'administrator'
            ? 'Administrator'
            : r.author_role === 'responder'
              ? 'Assigned Officer (Ministry / Agency)'
              : (r.author_role || 'Officer');

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1B4D3E')
          .text(`Response ${idx + 1} — ${r.author_name || 'Officer'} · ${roleLabel}`);
        doc.font('Helvetica').fontSize(8).fillColor('#666666')
          .text(`Dated: ${formatDate(r.created_at)}`);
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(9).fillColor('#222222')
          .text(r.message || '—', { align: 'justify', lineGap: 2 });
        doc.moveDown(0.5);
      });
    }

    // ── Certification / signature block ─────────────────────────────────────
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(1);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#C9C4B4').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    section('6. Certification');
    doc.font('Helvetica').fontSize(9).fillColor('#222222')
      .text(
        'This document is generated from the Townhall digital participatory governance system. ' +
        'It reflects the incident particulars, geographic reference, citizen-submitted evidence, ' +
        'and any official responses recorded by the assigned officer at the time of generation.'
      );
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    doc.text('_________________________________');
    doc.text('Authorised Officer / System Record');
    doc.moveDown(0.3);
    doc.text(`Generated: ${formatDate(new Date())}`);
    doc.text(`Reference: ${refNo}`);

    // Footer on each page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#888888')
        .text(
          'Townhall · Official Incident Report · For official and citizen reference · Page ' +
            `${i - range.start + 1} of ${range.count}`,
          left,
          doc.page.height - 36,
          { width: contentWidth, align: 'center' }
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