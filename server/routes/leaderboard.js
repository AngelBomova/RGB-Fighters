import express from 'express';
import pool from '../db.js';
import { withSpecialWins, withSpecialWinsRows } from '../specialWins.js';

const router = express.Router();

router.get('/top-wlr', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, wins, losses, CASE WHEN losses = 0 THEN CAST(wins AS REAL) ELSE CAST(wins AS REAL) / losses END AS wlr FROM users'
    );
    const rows = withSpecialWinsRows(result.rows)
      .map((user) => ({ ...user, wlr: (Number(user.wins) || 0) / Math.max(1, Number(user.losses) || 0) }))
      .sort((a, b) => (Number(b.wlr) || 0) - (Number(a.wlr) || 0) || (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .slice(0, 10);
    res.json(rows);
  } catch (err) {
    console.error('Top WLR error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/top-wins', async (req, res) => {
  try {
    const result = await pool.query('SELECT username, wins, losses FROM users');
    const rows = withSpecialWinsRows(result.rows)
      .sort((a, b) => (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .slice(0, 10);
    res.json(rows);
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
    const userRow = withSpecialWins(userResult.rows[0]);
    const allUsers = withSpecialWinsRows(allResult.rows || [])
      .map((user) => ({ ...user, wlr: (Number(user.wins) || 0) / Math.max(1, Number(user.losses) || 0) }));
    const winsRank = [...allUsers]
      .sort((a, b) => (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .findIndex((user) => user.username === username) + 1;
    const wlrRank = [...allUsers]
      .sort((a, b) => (Number(b.wlr) || 0) - (Number(a.wlr) || 0) || (Number(b.wins) || 0) - (Number(a.wins) || 0) || String(a.username).localeCompare(String(b.username)))
      .findIndex((user) => user.username === username) + 1;

    res.json({ ...userRow, wlr: (Number(userRow.wins) || 0) / Math.max(1, Number(userRow.losses) || 0), winsRank, wlrRank });
  } catch (err) {
    console.error('Rank error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
