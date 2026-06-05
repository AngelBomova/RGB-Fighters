import express from 'express';
import bcryptjs from 'bcryptjs';
import pool from '../db.js';
import { signToken, verifyToken } from '../middleware/auth.js';
import { isAllowedUsername, normalizeUsername, MAX_USERNAME_LENGTH } from '../usernameRules.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (cleanUsername.length > MAX_USERNAME_LENGTH) {
      return res.status(400).json({ error: `Username must be ${MAX_USERNAME_LENGTH} characters or fewer` });
    }

    if (!isAllowedUsername(cleanUsername)) {
      return res.status(400).json({ error: 'Username contains blocked words' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [cleanUsername]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hash = await bcryptjs.hash(password, 10);

    const emailPlaceholder = `${cleanUsername}@local`;
    const result = await pool.query(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username, elo, wins, losses',
      [emailPlaceholder, cleanUsername, hash]
    );

    const user = result.rows[0];
    const token = signToken(user.id, user.username);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, elo, wins, losses FROM users WHERE username = $1',
      [cleanUsername]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcryptjs.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user.id, user.username);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, elo, wins, losses FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
