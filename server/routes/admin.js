// server/routes/admin.js
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');
const rbac    = require('../middleware/rbac');
const { notify } = require('../services/realtime');

// Only Admins can access these routes
router.use(auth, rbac('administrator'));

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [usersRes, reportsRes, pollsRes, wardsRes, recentRes] = await Promise.all([
      pool.query("SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY count DESC"),
      pool.query("SELECT status, COUNT(*)::int AS count FROM reports GROUP BY status ORDER BY count DESC"),
      pool.query("SELECT category, COUNT(*)::int AS count FROM polls GROUP BY category ORDER BY count DESC"),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(location), ''), 'Unknown Ward') AS ward,
          COUNT(*)::int AS report_count
        FROM reports
        GROUP BY ward
        ORDER BY report_count DESC
        LIMIT 15
      `),
      // Recent activity for admin feed
      pool.query(`
        SELECT r.id, r.title, r.status, r.category, r.created_at, r.updated_at,
               u.name AS reporter_name
        FROM reports r
        JOIN users u ON r.user_id = u.id
        ORDER BY COALESCE(r.updated_at, r.created_at) DESC
        LIMIT 10
      `),
    ]);

    res.json({
      users:   usersRes.rows,
      reports: reportsRes.rows,
      polls:   pollsRes.rows,
      wards:   wardsRes.rows,
      recent:  recentRes.rows,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/admin/users ────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role, ward_id, created_at
      FROM users
      ORDER BY
        CASE role
          WHEN 'administrator' THEN 1
          WHEN 'responder' THEN 2
          ELSE 3
        END,
        name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
router.patch('/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const allowed = ['citizen', 'responder', 'administrator'];

  if (!allowed.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, name, email, role, ward_id, created_at`,
      [role, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Real-time notify the user whose role changed
    notify({
      userId: user.id,
      event: 'notification',
      payload: {
        type: 'role_change',
        title: 'Your role was updated',
        message: `An administrator changed your role to "${role}".`,
        role,
      },
    });

    res.json(user);
  } catch (err) {
    console.error('[admin/users/role]', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── GET /api/admin/responders ───────────────────────────────────────────────
router.get('/responders', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email FROM users WHERE role = 'responder' ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch responders' });
  }
});

// ─── PATCH /api/admin/reports/:id/assign ─────────────────────────────────────
router.patch('/reports/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { responderId } = req.body;

  if (!responderId) {
    return res.status(400).json({ error: 'responderId is required' });
  }

  try {
    // Verify responder exists
    const check = await pool.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'responder'`,
      [responderId]
    );
    if (check.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid responder' });
    }

    const result = await pool.query(
      `UPDATE reports
       SET assigned_to = $1, status = 'assigned', updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [responderId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = result.rows[0];
    const responderName = check.rows[0].name;

    // Notify the assigned responder
    notify({
      userId: responderId,
      roles: ['responder'],
      event: 'notification',
      payload: {
        type: 'report_assigned',
        title: 'New report assigned to you',
        message: `"${report.title}" has been assigned to you.`,
        reportId: report.id,
      },
    });

    // Notify admins
    notify({
      roles: ['administrator'],
      event: 'notification',
      payload: {
        type: 'report_assigned',
        title: 'Report assigned',
        message: `"${report.title}" assigned to ${responderName}.`,
        reportId: report.id,
      },
    });

    res.json(report);
  } catch (err) {
    console.error('[admin/assign]', err);
    res.status(500).json({ error: 'Failed to assign report' });
  }
});

// ─── GET /api/admin/queue-status ─────────────────────────────────────────────
router.get('/queue-status', (req, res) => {
  try {
    const syncQueue = require('../services/syncQueue');
    res.json({
      queueSize: syncQueue.size,
      items:     syncQueue.snapshot,
    });
  } catch {
    res.json({ queueSize: 0, items: [] });
  }
});

module.exports = router;
