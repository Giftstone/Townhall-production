// server/routes/polls.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const auth = require('../middleware/auth');

const generateHash = (userId, pollId) => {
  return crypto.createHash('sha256').update(String(userId) + String(pollId)).digest('hex');
};

/** Build anonymous per-option tallies (no voter identity). */
async function getOptionCounts(pollIds) {
  if (!pollIds.length) return new Map();
  const { rows } = await pool.query(
    `
    SELECT poll_id, option_index, COUNT(*)::int AS count
    FROM votes
    WHERE poll_id = ANY($1::uuid[])
    GROUP BY poll_id, option_index
    `,
    [pollIds]
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.poll_id)) map.set(row.poll_id, {});
    map.get(row.poll_id)[row.option_index] = row.count;
  }
  return map;
}

// 1. GET ALL OPEN POLLS (+ anonymous option tallies)
router.get('/', auth, async (req, res) => {
  try {
    const pollsRes = await pool.query(`
      SELECT p.*, COUNT(v.id)::int AS total_votes
      FROM polls p
      LEFT JOIN votes v ON p.id = v.poll_id
      WHERE p.status = 'open'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    const openPolls = pollsRes.rows;
    const countsByPoll = await getOptionCounts(openPolls.map((p) => p.id));

    const userHashes = openPolls.map((p) => generateHash(req.user.id, p.id));
    const votedRes = await pool.query(
      'SELECT poll_id, option_index FROM votes WHERE vote_hash = ANY($1)',
      [userHashes]
    );
    const votedPollMap = new Map(votedRes.rows.map((r) => [r.poll_id, r.option_index]));

    const finalPolls = openPolls.map((p) => {
      const options = Array.isArray(p.options) ? p.options : [];
      const countMap = countsByPoll.get(p.id) || {};
      const option_counts = options.map((_, idx) => Number(countMap[idx] || 0));
      return {
        ...p,
        options,
        option_counts,
        total_votes: Number(p.total_votes) || option_counts.reduce((a, b) => a + b, 0),
        has_voted: votedPollMap.has(p.id),
        voted_option: votedPollMap.get(p.id),
      };
    });

    res.json(finalPolls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

// 2. CREATE A POLL
router.post('/', auth, async (req, res) => {
  const { category, description, options, report_id: reportId } = req.body;
  if (!category || !description || !options || options.length < 2) {
    return res.status(400).json({ error: 'Missing fields or need at least 2 options' });
  }

  const allowed = ['healthcare', 'education', 'water', 'roads', 'security'];
  const cat = allowed.includes(category) ? category : 'roads';
  const cleanOptions = options.map((o) => String(o).trim()).filter(Boolean);
  if (cleanOptions.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 non-empty options' });
  }

  try {
    // Optional link to a report (column may not exist on older DBs)
    let result;
    try {
      result = await pool.query(
        `INSERT INTO polls (category, description, options, report_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [cat, description, cleanOptions, reportId || null]
      );
    } catch (e) {
      if (e.code === '42703') {
        // report_id column missing — insert without it
        result = await pool.query(
          `INSERT INTO polls (category, description, options)
           VALUES ($1, $2, $3) RETURNING *`,
          [cat, description, cleanOptions]
        );
      } else {
        throw e;
      }
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// 3. CAST A VOTE (anonymous hash — no identity stored with the vote)
router.post('/:id/vote', auth, async (req, res) => {
  const { id } = req.params;
  const { optionIndex } = req.body;
  const hash = generateHash(req.user.id, id);

  if (optionIndex === undefined || optionIndex === null || Number.isNaN(Number(optionIndex))) {
    return res.status(400).json({ error: 'optionIndex is required' });
  }

  try {
    const pollRes = await pool.query('SELECT id, options FROM polls WHERE id = $1 AND status = $2', [
      id,
      'open',
    ]);
    if (pollRes.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found or closed' });
    }

    const options = pollRes.rows[0].options || [];
    const idx = Number(optionIndex);
    if (idx < 0 || idx >= options.length) {
      return res.status(400).json({ error: 'Invalid option' });
    }

    await pool.query(
      'INSERT INTO votes (poll_id, vote_hash, option_index) VALUES ($1, $2, $3)',
      [id, hash, idx]
    );

    // Return fresh anonymous tallies (still no identities)
    const countsByPoll = await getOptionCounts([id]);
    const countMap = countsByPoll.get(id) || {};
    const option_counts = options.map((_, i) => Number(countMap[i] || 0));
    const total_votes = option_counts.reduce((a, b) => a + b, 0);

    res.json({
      message: 'Vote cast successfully!',
      option_counts,
      total_votes,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'You have already voted on this poll' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to cast vote' });
  }
});

module.exports = router;
