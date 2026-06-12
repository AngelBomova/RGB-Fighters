CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  elo INTEGER DEFAULT 1000 NOT NULL,
  wins INTEGER DEFAULT 0 NOT NULL,
  losses INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  player1_id INTEGER REFERENCES users(id),
  player2_id INTEGER REFERENCES users(id),
  winner_id INTEGER REFERENCES users(id),
  p1_rounds INTEGER NOT NULL,
  p2_rounds INTEGER NOT NULL,
  elo_change INTEGER NOT NULL,
  played_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  achievement_key TEXT NOT NULL,
  achieved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(wins DESC);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
