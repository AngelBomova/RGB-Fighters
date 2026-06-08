const defaultApiUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
const rawApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE || defaultApiUrl;
const API_URL = String(rawApiUrl).replace(/\/api\/?$/, '').replace(/\/$/, '');

async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, opts);
  } catch {
    throw { error: 'Could not reach the online server.' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

export async function register(username, password) {
  return request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function me(token) {
  return request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getLeaderboard() {
  const [winsResult, wlrResult] = await Promise.allSettled([
    request('/api/leaderboard/top-wins'),
    request('/api/leaderboard/top-wlr'),
  ]);
  const wins = winsResult.status === 'fulfilled' ? winsResult.value : [];
  const wlr = wlrResult.status === 'fulfilled'
    ? wlrResult.value
    : wins.map((user) => ({
        ...user,
        wlr: (Number(user.wins) || 0) / Math.max(1, Number(user.losses) || 0),
      }));
  return { wins, wlr };
}

export default { register, login, me, getLeaderboard };
