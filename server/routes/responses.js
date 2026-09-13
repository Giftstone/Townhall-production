// server/routes/responses.js
/**
 * Report Responses – responders and admins post comments/updates on a report.
 * Citizens can read responses on their own reports.
 *
 * Routes:
 *   GET    /api/responses/:reportId   – fetch all responses for a report
 *   POST   /api/responses/:reportId   – post a new response (responder/admin only)
 *   DELETE /api/responses/:id         – delete a response (admin only)
 *
 * Requires:  report_responses table from migration 001
 */

const express   = require('express');
const router    = express.Router();
const pool      = require('../db');
const auth      = require('../middleware/auth');
const rbac      = require('../middleware/rbac');
const syncQueue = require('../services/syncQueue');

// ─── GET responses for a report ──────────────────────────────────────────────
router.get('/:reportId', auth, async (req, res) => {
  const { reportId } = req.params;
  try {
    // Citizens may only read responses for their own reports
    if (req.user.role === 'citizen') {
      const ownerCheck = await pool.query(
        'SELECT id FROM reports WHERE id=$1 AND user_id=$2',
        [reportId, req.user.id]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied: not your report' });
      }
    }

    const result = await pool.query(
      `SELECT
         rr.id,
         rr.message,
         rr.created_at,
         u.name  AS author_name,
         u.role  AS author_role
       FROM report_responses rr
       JOIN users u ON u.id = rr.user_id
       WHERE rr.report_id = $1
       ORDER BY rr.created_at ASC`,
      [reportId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[responses GET]', err);
    res.status(500).json({ error: 'Failed to fetch responses' });
  }
});

// ─── POST a response ──────────────────────────────────────────────────────────
router.post('/:reportId', auth, rbac('responder', 'administrator'), async (req, res) => {
  const { reportId } = req.params;
  const { message }  = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO report_responses (report_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [reportId, req.user.id, message.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[responses POST]', err);

    // Offline / transient failure → enqueue for retry
    const queueId = syncQueue.enqueue({
      type:    'POST_RESPONSE',
      payload: { reportId, userId: req.user.id, message: message.trim() },
    });
    res.status(202).json({
      queued:  true,
      queueId,
      message: 'Response queued – will be saved once the connection is restored.',
    });
  }
});

// ─── DELETE a response (admin only) ──────────────────────────────────────────
router.delete('/:id', auth, rbac('administrator'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM report_responses WHERE id=$1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Response not found' });
    }
    res.json({ deleted: true, id });
  } catch (err) {
    console.error('[responses DELETE]', err);
    res.status(500).json({ error: 'Failed to delete response' });
  }
});

module.exports = router;
