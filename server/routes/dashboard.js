const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/stats', async (_req, res) => {
  try {
    const [reports, byStatus, byCategory, polls, users] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM reports'),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM reports GROUP BY status ORDER BY status`
      ),
      pool.query(
        `SELECT category, COUNT(*)::int AS count
         FROM reports GROUP BY category ORDER BY count DESC`
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM polls WHERE status = 'open'`),
      pool.query('SELECT COUNT(*)::int AS total FROM users'),
    ]);

    res.json({
      totalReports: reports.rows[0].total,
      openPolls: polls.rows[0].total,
      totalUsers: users.rows[0].total,
      byStatus: byStatus.rows,
      byCategory: byCategory.rows,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

router.get('/priorities', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT category, ward_id, ward_name, frequency, deficit_index, priority_score
       FROM ranked_priorities
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Priorities error:', err);
    res.status(500).json({ error: 'Failed to load priorities' });
  }
});

// ─── GET /api/dashboard/ward-analytics ───────────────────────────────────────
// Responder analytics for the ward they belong to.
// Groups reports by category (e.g. cholera / pipe bursts) for bar charts.
// Each category includes the list of report IDs so bars are clickable.
router.get('/ward-analytics', async (req, res) => {
  try {
    const userRes = await pool.query(
      `SELECT u.id, u.role, u.ward_id, w.name AS ward_name
       FROM users u
       LEFT JOIN wards w ON w.id = u.ward_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const me = userRes.rows[0];

    if (me.role !== 'responder' && me.role !== 'administrator') {
      return res.status(403).json({ error: 'Only responders and administrators can access ward analytics' });
    }

    if (me.role === 'responder' && !me.ward_id) {
      return res.status(400).json({
        error: 'Your account is not assigned to a ward. Contact an administrator.',
      });
    }

    let wardId = me.ward_id;
    let wardName = me.ward_name;
    if (me.role === 'administrator' && req.query.ward_id) {
      wardId = Number(req.query.ward_id);
      const w = await pool.query('SELECT name FROM wards WHERE id = $1', [wardId]);
      wardName = w.rows[0]?.name || null;
    }

    const reportsRes = await pool.query(
      `
      SELECT
        r.id, r.title, r.category, r.status, r.location, r.created_at, r.assigned_to
      FROM reports r
      WHERE
        (
          $1::int IS NOT NULL
          AND (
            LOWER(TRIM(COALESCE(r.location, ''))) = LOWER(TRIM($2::text))
            OR r.assigned_to IN (SELECT id FROM users WHERE ward_id = $1 AND role = 'responder')
            OR r.user_id IN (SELECT id FROM users WHERE ward_id = $1)
          )
        )
        OR $1::int IS NULL
      ORDER BY r.created_at DESC
      `,
      [wardId || null, wardName || '']
    );

    const reports = reportsRes.rows;
    const byCategoryMap = {};
    reports.forEach((r) => {
      const cat = r.category || 'Uncategorised';
      if (!byCategoryMap[cat]) {
        byCategoryMap[cat] = { category: cat, count: 0, reports: [] };
      }
      byCategoryMap[cat].count += 1;
      byCategoryMap[cat].reports.push({
        id: r.id,
        title: r.title,
        status: r.status,
        created_at: r.created_at,
      });
    });

    const byCategory = Object.values(byCategoryMap).sort((a, b) => b.count - a.count);

    const byStatusMap = {};
    reports.forEach((r) => {
      const st = r.status || 'unknown';
      byStatusMap[st] = (byStatusMap[st] || 0) + 1;
    });
    const byStatus = Object.entries(byStatusMap).map(([status, count]) => ({ status, count }));

    res.json({
      ward_id: wardId,
      ward_name: wardName,
      totalReports: reports.length,
      byCategory,
      byStatus,
    });
  } catch (err) {
    console.error('[dashboard/ward-analytics]', err);
    res.status(500).json({ error: 'Failed to load ward analytics' });
  }
});

module.exports = router;
