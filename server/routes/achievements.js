import express from 'express';
import pool from '../db.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();
const COLORS = new Set(['red', 'blue', 'green', 'black', 'white', 'purple', 'yellow', 'orange', 'gray']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const OFFLINE_ACHIEVEMENTS = [...COLORS].flatMap((color) => [...DIFFICULTIES].map((difficulty) => `ladder:${color}:${difficulty}`));
const SPECIAL_ACHIEVEMENTS = ['online:rainbow'];
const FULL_ACHIEVEMENTS = [...OFFLINE_ACHIEVEMENTS, ...SPECIAL_ACHIEVEMENTS];

const defaultAchievementsForUsername = (username) => {
  if (username === 'Server Owner' || username === 'Jinxy' || username === 'Austin7') return FULL_ACHIEVEMENTS;
  if (username === 'Sebas') return OFFLINE_ACHIEVEMENTS;
  return [];
};

const unlockAchievement = async (userId, achievementKey) => {
  await pool.query(
    'INSERT INTO achievements (user_id, achievement_key) VALUES ($1, $2) ON CONFLICT (user_id, achievement_key) DO NOTHING',
    [userId, achievementKey]
  );
};

router.get('/', verifyToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);
    const username = userResult.rows?.[0]?.username || '';
    const result = await pool.query(
      'SELECT achievement_key FROM achievements WHERE user_id = $1 ORDER BY achievement_key',
      [req.userId]
    );
    const merged = new Set([
      ...result.rows.map((row) => row.achievement_key),
      ...defaultAchievementsForUsername(username),
    ]);
    res.json({ achievements: [...merged].sort() });
  } catch (err) {
    console.error('Achievements fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/ladder', verifyToken, async (req, res) => {
  try {
    const color = String(req.body?.color || '').toLowerCase();
    const difficulty = String(req.body?.difficulty || '').toLowerCase();

    if (!COLORS.has(color) || !DIFFICULTIES.has(difficulty)) {
      return res.status(400).json({ error: 'Invalid ladder achievement' });
    }

    await unlockAchievement(req.userId, `ladder:${color}:${difficulty}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ladder achievement error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export { unlockAchievement };
export default router;
