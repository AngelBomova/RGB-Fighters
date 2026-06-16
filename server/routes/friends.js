import express from 'express';
import pool from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { normalizeUsername } from '../usernameRules.js';

const router = express.Router();
const MAX_FRIENDS = 20;
const INVITE_TYPES = new Set(['private1v1', 'private2v2', 'online2v2']);

router.get('/', verifyToken, async (req, res) => {
  try {
    const [incoming, outgoing, friends, private1v1, private2v2, online2v2, acceptedInvites] = await Promise.all([
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
      pool.query(
        `SELECT gi.id, gi.from_user_id, u.username, gi.created_at
         FROM game_invites gi
         JOIN users u ON u.id = gi.from_user_id
         WHERE gi.to_user_id = $1 AND gi.status = 'pending' AND gi.invite_type = 'private1v1'
           AND gi.created_at > NOW() - INTERVAL '1 minute'
         ORDER BY gi.id DESC`,
        [req.userId]
      ),
      pool.query(
        `SELECT gi.id, gi.from_user_id, u.username, gi.created_at
         FROM game_invites gi
         JOIN users u ON u.id = gi.from_user_id
         WHERE gi.to_user_id = $1 AND gi.status = 'pending' AND gi.invite_type = 'private2v2'
           AND gi.created_at > NOW() - INTERVAL '1 minute'
         ORDER BY gi.id DESC`,
        [req.userId]
      ),
      pool.query(
        `SELECT gi.id, gi.from_user_id, u.username, gi.created_at
         FROM game_invites gi
         JOIN users u ON u.id = gi.from_user_id
         WHERE gi.to_user_id = $1 AND gi.status = 'pending' AND gi.invite_type = 'online2v2'
           AND gi.created_at > NOW() - INTERVAL '1 minute'
         ORDER BY gi.id DESC`,
        [req.userId]
      ),
      pool.query(
        `SELECT gi.id, gi.to_user_id, gi.invite_type, u.username, gi.created_at
         FROM game_invites gi
         JOIN users u ON u.id = gi.to_user_id
         WHERE gi.from_user_id = $1 AND gi.status = 'accepted'
           AND gi.created_at > NOW() - INTERVAL '1 minute'
         ORDER BY gi.id DESC`,
        [req.userId]
      ),
    ]);

    res.json({
      incoming: incoming.rows || [],
      outgoing: outgoing.rows || [],
      friends: friends.rows || [],
      private1v1Requests: private1v1.rows || [],
      private2v2Requests: private2v2.rows || [],
      online2v2Requests: online2v2.rows || [],
      acceptedInvites: acceptedInvites.rows || [],
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

    const targetResult = await pool.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username]);
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

    const [myCount, theirCount] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM friends WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COUNT(*) AS count FROM friends WHERE user_id = $1', [target.id]),
    ]);
    if (Number(myCount.rows?.[0]?.count || 0) >= MAX_FRIENDS) {
      return res.status(400).json({ error: `You can only have ${MAX_FRIENDS} friends` });
    }
    if (Number(theirCount.rows?.[0]?.count || 0) >= MAX_FRIENDS) {
      return res.status(400).json({ error: `${target.username} already has ${MAX_FRIENDS} friends` });
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
      const [myCount, theirCount] = await Promise.all([
        pool.query('SELECT COUNT(*) AS count FROM friends WHERE user_id = $1', [request.to_user_id]),
        pool.query('SELECT COUNT(*) AS count FROM friends WHERE user_id = $1', [request.from_user_id]),
      ]);
      if (Number(myCount.rows?.[0]?.count || 0) >= MAX_FRIENDS || Number(theirCount.rows?.[0]?.count || 0) >= MAX_FRIENDS) {
        return res.status(400).json({ error: `Friend limit is ${MAX_FRIENDS}` });
      }
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

router.post('/unfriend', verifyToken, async (req, res) => {
  try {
    const friendId = Number(req.body?.friendId);
    if (!friendId) return res.status(400).json({ error: 'Missing friend id' });

    await pool.query(
      'DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [req.userId, friendId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Unfriend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/invite', verifyToken, async (req, res) => {
  try {
    const friendId = Number(req.body?.friendId);
    const inviteType = String(req.body?.inviteType || '');
    if (!friendId || !INVITE_TYPES.has(inviteType)) return res.status(400).json({ error: 'Invalid invite' });

    const friendCheck = await pool.query(
      'SELECT friend_id FROM friends WHERE user_id = $1 AND friend_id = $2',
      [req.userId, friendId]
    );
    if (friendCheck.rows.length === 0) return res.status(400).json({ error: 'You can only invite friends' });

    const existing = await pool.query(
      `SELECT id FROM game_invites
       WHERE from_user_id = $1 AND to_user_id = $2 AND invite_type = $3 AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      [req.userId, friendId, inviteType]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'That invite is already pending' });

    await pool.query(
      'INSERT INTO game_invites (from_user_id, to_user_id, invite_type, status) VALUES ($1, $2, $3, $4)',
      [req.userId, friendId, inviteType, 'pending']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/invite/respond', verifyToken, async (req, res) => {
  try {
    const inviteId = Number(req.body?.inviteId);
    const action = req.body?.action === 'accept' ? 'accept' : 'decline';
    if (!inviteId) return res.status(400).json({ error: 'Missing invite id' });

    const result = await pool.query(
      'SELECT id, invite_type, from_user_id, to_user_id, status, created_at FROM game_invites WHERE id = $1 AND to_user_id = $2',
      [inviteId, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });
    const invite = result.rows[0];
    if (invite.status !== 'pending') return res.status(400).json({ error: 'Invite is no longer pending' });
    const ageMs = Date.now() - new Date(invite.created_at || Date.now()).getTime();
    if (ageMs > 60000) {
      await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['expired', invite.id]);
      return res.status(400).json({ error: 'Invite expired' });
    }

    await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', [
      action === 'accept' ? 'accepted' : 'declined',
      invite.id,
    ]);
    res.json({ ok: true, inviteId: invite.id, inviteType: invite.invite_type, fromUserId: invite.from_user_id });
  } catch (err) {
    console.error('Invite response error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
