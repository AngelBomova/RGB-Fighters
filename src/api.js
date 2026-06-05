const rawApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const API_URL = String(rawApiUrl).replace(/\/api\/?$/, '').replace(/\/$/, '');

async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, opts);
  } catch {
    throw { error: 'Could not reach the online server. Make sure npm run server is running.' };
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
  const wins = await request('/api/leaderboard/top-wins');
  const elo = await request('/api/leaderboard/top-elo');
  return { wins, elo };
}

export default { register, login, me, getLeaderboard };
