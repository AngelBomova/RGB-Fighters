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
  if (!res.ok) throw { ...data, status: res.status, error: data.error || `Server returned ${res.status}` };
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

export async function resetPassword(token, currentPassword, newPassword) {
  try {
    return await request('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token, currentPassword, newPassword }),
    });
  } catch (err) {
    if (err?.status === 404) {
      throw {
        ...err,
        error: 'Password reset route is missing on the running server. Restart or redeploy the backend.',
      };
    }
    throw err;
  }
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

export async function getRank(username) {
  return request(`/api/leaderboard/rank/${encodeURIComponent(username)}`);
}

export async function getAchievements(token) {
  return request('/api/achievements', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getFriends(token) {
  return request('/api/friends', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendFriendRequest(token, username) {
  return request('/api/friends/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username }),
  });
}

export async function respondFriendRequest(token, requestId, action) {
  return request('/api/friends/respond', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ requestId, action }),
  });
}

export async function unfriend(token, friendId) {
  return request('/api/friends/unfriend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ friendId }),
  });
}

export async function sendGameInvite(token, friendId, inviteType) {
  return request('/api/friends/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ friendId, inviteType }),
  });
}

export async function respondGameInvite(token, inviteId, action) {
  return request('/api/friends/invite/respond', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ inviteId, action }),
  });
}

export async function unlockLadderAchievement(token, color, difficulty) {
  return request('/api/achievements/ladder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ color, difficulty }),
  });
}

export default {
  register,
  login,
  me,
  resetPassword,
  getLeaderboard,
  getRank,
  getAchievements,
  getFriends,
  sendFriendRequest,
  respondFriendRequest,
  unfriend,
  sendGameInvite,
  respondGameInvite,
  unlockLadderAchievement,
};
