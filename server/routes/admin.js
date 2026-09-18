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
      SELECT u.id, u.name, u.email, u.role, u.ward_id, w.name AS ward_name, u.created_at
      FROM users u
      LEFT JOIN wards w ON w.id = u.ward_id
      ORDER BY
        CASE u.role
          WHEN 'administrator' THEN 1
          WHEN 'responder' THEN 2
          ELSE 3
        END,
        u.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
// Also accepts optional ward_id (required in practice when promoting to responder)
router.patch('/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role, ward_id } = req.body;
  const allowed = ['citizen', 'responder', 'administrator'];

  if (!allowed.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Responders should belong to a named ward
  if (role === 'responder' && (ward_id === undefined || ward_id === null || ward_id === '')) {
    return res.status(400).json({
      error: 'Responders must be assigned to a named ward. Provide ward_id.',
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           ward_id = CASE
             WHEN $1 = 'responder' THEN $3::int
             WHEN $3::int IS NOT NULL THEN $3::int
             ELSE ward_id
           END
       WHERE id = $2
       RETURNING id, name, email, role, ward_id, created_at`,
      [role, id, ward_id ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    notify({
      userId: user.id,
      event: 'notification',
      payload: {
        type: 'role_change',
        title: 'Your role was updated',
        message: `An administrator changed your role to "${role}".`,
        role,
        ward_id: user.ward_id,
      },
    });

    res.json(user);
  } catch (err) {
    console.error('[admin/users/role]', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── PATCH /api/admin/users/:id/ward ─────────────────────────────────────────
// Explicitly assign / change a responder's ward
router.patch('/users/:id/ward', async (req, res) => {
  const { id } = req.params;
  const { ward_id } = req.body;

  if (ward_id === undefined || ward_id === null) {
    return res.status(400).json({ error: 'ward_id is required' });
  }

  try {
    const wardCheck = await pool.query('SELECT id, name FROM wards WHERE id = $1', [ward_id]);
    if (wardCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid ward_id' });
    }

    const result = await pool.query(
      `UPDATE users SET ward_id = $1 WHERE id = $2
       RETURNING id, name, email, role, ward_id, created_at`,
      [ward_id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ ...result.rows[0], ward_name: wardCheck.rows[0].name });
  } catch (err) {
    console.error('[admin/users/ward]', err);
    res.status(500).json({ error: 'Failed to update ward' });
  }
});

// ─── GET /api/admin/responders ───────────────────────────────────────────────
router.get('/responders', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.ward_id, w.name AS ward_name
       FROM users u
       LEFT JOIN wards w ON w.id = u.ward_id
       WHERE u.role = 'responder'
       ORDER BY w.name NULLS LAST, u.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch responders' });
  }
});

// ─── GET /api/admin/wards ────────────────────────────────────────────────────
router.get('/wards', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, deficit_index FROM wards ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wards' });
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
