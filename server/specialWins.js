const SPECIAL_100_WIN_USERS = new Set(['Jinxy', 'Server Owner', 'Sebas']);

export const hasSpecialWins = (username) => SPECIAL_100_WIN_USERS.has(String(username || ''));

export const withSpecialWins = (user) => {
  if (!user || !hasSpecialWins(user.username)) return user;
  const wins = Math.max(Number(user.wins) || 0, 100);
  const losses = Number(user.losses) || 0;
  return {
    ...user,
    wins,
    losses,
    wlr: 'wlr' in user ? wins / Math.max(1, losses) : user.wlr,
  };
};

export const withSpecialWinsRows = (rows = []) => rows.map(withSpecialWins);

export async function ensureSpecialWins(pool, username = null) {
  const usernames = username ? [username] : [...SPECIAL_100_WIN_USERS];
  for (const name of usernames) {
    if (!hasSpecialWins(name)) continue;
    await pool.query(
      'UPDATE users SET wins = CASE WHEN wins < 100 THEN 100 ELSE wins END WHERE username = $1',
      [name]
    );
  }
}
