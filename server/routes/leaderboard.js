import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/top-wlr', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, wins, losses, CASE WHEN losses = 0 THEN CAST(wins AS REAL) ELSE CAST(wins AS REAL) / losses END AS wlr FROM users ORDER BY wlr DESC, wins DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Top WLR error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/top-wins', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, wins, losses FROM users ORDER BY wins DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Top wins error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/rank/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '');
    const userResult = await pool.query(
      'SELECT username, wins, losses, CASE WHEN losses = 0 THEN CAST(wins AS REAL) ELSE CAST(wins AS REAL) / losses END AS wlr FROM users WHERE username = $1',
      [username]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const allResult = await pool.query(
      'SELECT username, wins, losses, CASE WHEN losses = 0 THEN CAST(wins AS REAL) ELSE CAST(wins AS REAL) / losses END AS wlr FROM users'
    );
    const allUsers = allResult.rows || [];
    const winsRank = [...allUsers]
      .sort((a, b) => (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .findIndex((user) => user.username === username) + 1;
    const wlrRank = [...allUsers]
      .sort((a, b) => (Number(b.wlr) || 0) - (Number(a.wlr) || 0) || (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .findIndex((user) => user.username === username) + 1;

    res.json({ ...userResult.rows[0], winsRank, wlrRank });
  } catch (err) {
    console.error('Rank error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
