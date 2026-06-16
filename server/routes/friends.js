import express from 'express';
import pool from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { normalizeUsername } from '../usernameRules.js';

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  try {
    const [incoming, outgoing, friends] = await Promise.all([
      pool.query(
        `SELECT fr.id, fr.from_user_id, u.username, fr.created_at
         FROM friend_requests fr
         JOIN users u ON u.id = fr.from_user_id
         WHERE fr.to_user_id = $1 AND fr.status = 'pending'
         ORDER BY fr.id DESC`,
        [req.userId]
      ),
      pool.query(
        `SELECT fr.id, fr.to_user_id, u.username, fr.created_at
         FROM friend_requests fr
         JOIN users u ON u.id = fr.to_user_id
         WHERE fr.from_user_id = $1 AND fr.status = 'pending'
         ORDER BY fr.id DESC`,
        [req.userId]
      ),
      pool.query(
        `SELECT u.id, u.username, u.elo, u.wins, u.losses
         FROM friends f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1
         ORDER BY lower(u.username)`,
        [req.userId]
      ),
    ]);

    res.json({
      incoming: incoming.rows || [],
      outgoing: outgoing.rows || [],
      friends: friends.rows || [],
      private1v1Requests: [],
      private2v2Requests: [],
      online2v2Requests: [],
    });
  } catch (err) {
    console.error('Friends list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/request', verifyToken, async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: 'Enter a username' });

    const targetResult = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const target = targetResult.rows[0];
    if (Number(target.id) === Number(req.userId)) {
      return res.status(400).json({ error: 'You cannot add yourself' });
    }

    const existingFriend = await pool.query(
      'SELECT friend_id FROM friends WHERE user_id = $1 AND friend_id = $2',
      [req.userId, target.id]
    );
    if (existingFriend.rows.length > 0) {
      return res.status(400).json({ error: 'Already friends' });
    }

    const existingRequest = await pool.query(
      `SELECT id, from_user_id, to_user_id, status
       FROM friend_requests
       WHERE (from_user_id = $1 AND to_user_id = $2)
          OR (from_user_id = $2 AND to_user_id = $1)
       ORDER BY id DESC
       LIMIT 1`,
      [req.userId, target.id]
    );

    if (existingRequest.rows.length > 0) {
      const request = existingRequest.rows[0];
      if (request.status === 'pending') {
        return res.status(400).json({ error: 'A friend request is already pending' });
      }
      await pool.query(
        'UPDATE friend_requests SET from_user_id = $1, to_user_id = $2, status = $3 WHERE id = $4',
        [req.userId, target.id, 'pending', request.id]
      );
    } else {
      await pool.query(
        'INSERT INTO friend_requests (from_user_id, to_user_id, status) VALUES ($1, $2, $3)',
        [req.userId, target.id, 'pending']
      );
    }

    res.json({ ok: true, username: target.username });
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/respond', verifyToken, async (req, res) => {
  try {
    const requestId = Number(req.body?.requestId);
    const action = req.body?.action === 'accept' ? 'accept' : 'decline';
    if (!requestId) return res.status(400).json({ error: 'Missing request id' });

    const result = await pool.query(
      'SELECT id, from_user_id, to_user_id, status FROM friend_requests WHERE id = $1 AND to_user_id = $2',
      [requestId, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Friend request not found' });

    const request = result.rows[0];
    if (request.status !== 'pending') return res.status(400).json({ error: 'Request is no longer pending' });

    if (action === 'accept') {
      await pool.query(
        'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT (user_id, friend_id) DO NOTHING',
        [request.from_user_id, request.to_user_id]
      );
      await pool.query(
        'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT (user_id, friend_id) DO NOTHING',
        [request.to_user_id, request.from_user_id]
      );
    }

    await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2', [
      action === 'accept' ? 'accepted' : 'declined',
      request.id,
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Friend response error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
