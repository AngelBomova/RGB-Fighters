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

export default router;
