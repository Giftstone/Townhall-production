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
// Official government-style PDF with real OSM map snapshot, evidence, responses
router.get('/:id/pdf', async (req, res) => {
  const https = require('https');
  const http = require('http');
  const PDFDocument = require('pdfkit');

  const fetchBuffer = (url, timeoutMs = 12000, redirects = 0) =>
    new Promise((resolve, reject) => {
      try {
        const lib = url.startsWith('https') ? https : http;
        const reqNet = lib.get(
          url,
          {
            timeout: timeoutMs,
            headers: {
              // OSM tile usage policy requires a descriptive User-Agent
              'User-Agent': 'TownhallCivicPlatform/1.0 (incident-report-pdf; contact: admin@townhall.local)',
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

  /** Convert WGS84 to OSM tile x/y at a zoom level */
  const latLngToTile = (lat, lng, zoom) => {
    const n = 2 ** zoom;
    const x = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const y =
      ((1 -
        Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
        2) *
      n;
    return { x, y, n };
  };

  /**
   * Build a real map snapshot by fetching a 2×2 grid of OSM tiles and
   * returning the tile buffers + marker pixel offset for PDF composition.
   */
  const buildOsmMapTiles = async (lat, lng, zoom = 14) => {
    const { x, y } = latLngToTile(lat, lng, zoom);
    const x0 = Math.floor(x) - 0; // top-left tile
    const y0 = Math.floor(y) - 0;
    // Use 2x2 tiles centered roughly on the point
    const tx0 = Math.floor(x) - (x - Math.floor(x) < 0.5 ? 1 : 0);
    const ty0 = Math.floor(y) - (y - Math.floor(y) < 0.5 ? 1 : 0);

    const tiles = []; // [{dx, dy, buffer}]
    const coords = [
      [tx0, ty0],
      [tx0 + 1, ty0],
      [tx0, ty0 + 1],
      [tx0 + 1, ty0 + 1],
    ];

    await Promise.all(
      coords.map(async ([tx, ty]) => {
        const url = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
        try {
          const buf = await fetchBuffer(url);
          if (buf && buf.length > 100 && buf[0] === 0x89) {
            tiles.push({ tx, ty, dx: tx - tx0, dy: ty - ty0, buffer: buf });
          }
        } catch (e) {
          console.warn('[reports PDF] tile failed', tx, ty, e.message);
        }
      })
    );

    if (tiles.length === 0) return null;

    // Marker position in the stitched 512×512 image (2×2 of 256px tiles)
    const markerPx = {
      x: (x - tx0) * 256,
      y: (y - ty0) * 256,
    };

    return { tiles, markerPx, tileSize: 256, grid: 2, zoom, tx0, ty0 };
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
    let mapTiles = null;
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      try {
        mapTiles = await buildOsmMapTiles(lat, lng, 14);
      } catch (e) {
        console.warn('[reports PDF] OSM tiles failed:', e.message);
      }
    }

    // Footer band reserved on every page (must not create an extra page)
    const FOOTER_BAND = 48;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: FOOTER_BAND + 8, left: 50, right: 50 },
      bufferPages: true,
      autoFirstPage: true,
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
    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const maxY = () => doc.page.height - doc.page.margins.bottom;

    const ensureSpace = (needed = 60) => {
      if (doc.y + needed > maxY()) {
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
      doc.moveDown(0.45);
    };

    const sectionTitle = (title) => {
      ensureSpace(36);
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B4D3E').text(title.toUpperCase());
      doc
        .moveTo(left, doc.y)
        .lineTo(left + 160, doc.y)
        .strokeColor('#1B4D3E')
        .lineWidth(0.9)
        .stroke();
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor('#222222');
    };

    // ── Top accent bar ──────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 8).fill('#1B4D3E');
    doc.y = 28;

    // ── Letterhead ──────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B4D3E')
      .text('REPUBLIC OF ZAMBIA', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#333333')
      .text('LOCAL GOVERNMENT — CIVIC PARTICIPATION CHANNEL', { align: 'center' });
    doc.moveDown(0.15);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1B2420')
      .text('TOWNHALL', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
      .text('Digital Participatory Governance Platform', { align: 'center' });
    doc.moveDown(0.3);
    hr('#1B4D3E', 1.5);

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1B2420')
      .text('OFFICIAL INCIDENT REPORT', { align: 'center' });
    doc.moveDown(0.4);

    // ── Document control ────────────────────────────────────────────────────
    const col2 = left + contentWidth / 2;
    const metaY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    doc.text(`Reference No.: ${refNo}`, left, metaY, { width: contentWidth / 2 - 8 });
    doc.text(`Date of Issue: ${formatDate(new Date())}`, col2, metaY, {
      width: contentWidth / 2 - 8,
    });
    doc.text(`Date Submitted: ${formatDate(report.created_at)}`, left, metaY + 14, {
      width: contentWidth / 2 - 8,
    });
    doc.text(`Status: ${statusLabel(report.status)}`, col2, metaY + 14, {
      width: contentWidth / 2 - 8,
    });
    doc.y = metaY + 32;
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

    // ── 3. Real map snapshot (OSM tiles) ─────────────────────────────────────
    sectionTitle('3. Location Snapshot');
    if (mapTiles && mapTiles.tiles.length > 0) {
      ensureSpace(250);
      const displaySize = Math.min(contentWidth, 420); // square-ish map
      const scale = displaySize / (mapTiles.tileSize * mapTiles.grid);
      const mapW = mapTiles.tileSize * mapTiles.grid * scale;
      const mapH = mapW;
      const mapX = left + (contentWidth - mapW) / 2;
      const mapY = doc.y;

      // Frame
      doc.rect(mapX - 1, mapY - 1, mapW + 2, mapH + 2)
        .strokeColor('#1B4D3E')
        .lineWidth(1)
        .stroke();

      // Draw each tile
      for (const t of mapTiles.tiles) {
        const dx = mapX + t.dx * mapTiles.tileSize * scale;
        const dy = mapY + t.dy * mapTiles.tileSize * scale;
        try {
          doc.image(t.buffer, dx, dy, {
            width: mapTiles.tileSize * scale,
            height: mapTiles.tileSize * scale,
          });
        } catch (e) {
          console.warn('[reports PDF] tile draw failed', e.message);
        }
      }

      // Red pin marker at incident coordinates
      const mx = mapX + mapTiles.markerPx.x * scale;
      const my = mapY + mapTiles.markerPx.y * scale;
      doc.save();
      doc.circle(mx, my - 6, 6).fill('#C62828');
      doc.circle(mx, my - 6, 2.5).fill('#FFFFFF');
      doc
        .moveTo(mx, my)
        .lineTo(mx - 4, my + 8)
        .lineTo(mx + 4, my + 8)
        .fill('#C62828');
      doc.restore();

      doc.y = mapY + mapH + 8;
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
        .text(
          `OpenStreetMap snapshot · ${lat.toFixed(6)}, ${lng.toFixed(6)} · © OpenStreetMap contributors`,
          { align: 'center' }
        );
    } else if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text(
          `Map tiles could not be retrieved from OpenStreetMap at generation time. ` +
            `Recorded coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}.`
        );
    } else {
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
      doc.moveDown(0.3);

      const gap = 12;
      const imgW = (contentWidth - gap) / 2;
      const imgH = 140;
      let col = 0;
      let rowY = doc.y;

      for (let i = 0; i < imagePaths.length; i++) {
        if (rowY + imgH > maxY()) {
          doc.addPage();
          rowY = doc.page.margins.top;
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
          doc.rect(x, rowY, imgW, imgH).strokeColor('#cccccc').stroke();
          doc.font('Helvetica').fontSize(8).fillColor('#999999')
            .text('Image unavailable', x + 8, rowY + imgH / 2 - 6, { width: imgW - 16 });
        }
        col += 1;
        if (col >= 2) {
          col = 0;
          rowY += imgH + 12;
        }
      }
      doc.y = col === 0 ? rowY : rowY + imgH + 8;
    }

    // ── 5. Official responses ───────────────────────────────────────────────
    sectionTitle('5. Official Response(s) by Assigned Officer');
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
      .text(
        'Official responses are posted only by the officer assigned to this incident ' +
          '(e.g. police officer, engineer, water & sanitation officer, district administration, ' +
          'or other authorised ministry staff).'
      );
    doc.moveDown(0.35);

    if (responses.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text('No official response has been recorded on this report to date.');
    } else {
      responses.forEach((r, idx) => {
        ensureSpace(64);
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
        doc.moveDown(0.12);
        doc.font('Helvetica').fontSize(10).fillColor('#222222')
          .text(r.message || '—', { align: 'justify', lineGap: 2 });
        doc.moveDown(0.4);
      });
    }

    // ── 6. Certification ────────────────────────────────────────────────────
    ensureSpace(110);
    sectionTitle('6. Certification');
    doc.font('Helvetica').fontSize(9).fillColor('#222222')
      .text(
        'This document is generated from the Townhall digital participatory governance system. ' +
          'It reflects the incident particulars, geographic reference, citizen-submitted evidence, ' +
          'and any official responses recorded by the assigned officer at the time of generation.'
      );
    doc.moveDown(0.7);
    doc.font('Helvetica').fontSize(10).fillColor('#222222')
      .text('_________________________________');
    doc.text('Authorised Officer / System Record');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9)
      .text(`Generated: ${formatDate(new Date())}`);
    doc.text(`Reference: ${refNo}`);

    // ── Footer on every existing page (does NOT create new pages) ───────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = doc.page.height - 36;
      // Draw inside the page; lineBreak:false prevents pdfkit from overflowing a new page
      doc
        .moveTo(left, footerY - 10)
        .lineTo(left + contentWidth, footerY - 10)
        .strokeColor('#C9C4B4')
        .lineWidth(0.5)
        .stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#888888')
        .text(
          `Townhall · Official Incident Report · For official and citizen reference · Page ${i + 1} of ${range.count}`,
          left,
          footerY,
          {
            width: contentWidth,
            align: 'center',
            lineBreak: false,
            height: 12,
            ellipsis: false,
          }
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