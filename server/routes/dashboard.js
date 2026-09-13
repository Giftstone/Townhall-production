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

module.exports = router;
