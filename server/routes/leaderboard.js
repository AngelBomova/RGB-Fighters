import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/top-elo', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, elo, wins, losses FROM users ORDER BY elo DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Top ELO error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/top-wins', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, wins, elo, losses FROM users ORDER BY wins DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Top wins error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
