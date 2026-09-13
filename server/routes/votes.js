// routes/votes.js — Anonymous one-person-one-vote
const crypto = require('crypto');

router.post('/votes', authenticate, async (req, res) => {
  const { pollId } = req.body;
  const voteHash = crypto
    .createHash('sha256')
    .update(req.user.id + pollId)
    .digest('hex');

  try {
    await db.query(
      'INSERT INTO votes (poll_id, vote_hash) VALUES ($1, $2)',
      [pollId, voteHash]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Already voted' });
    throw e;
  }
});