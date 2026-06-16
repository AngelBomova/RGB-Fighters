import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import { isAllowedUsername, makeReplacementUsername } from './usernameRules.js';
import { ensureSpecialWins } from './specialWins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_SQLITE = process.env.USE_SQLITE === '1'
  || DATABASE_URL.startsWith('sqlite')
  || (!DATABASE_URL && process.env.NODE_ENV !== 'production');

let pool = null;

async function initPostgres() {
  const pg = await import('pg');
  const { Pool } = pg;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rgb_fighters',
    max: 20,
  });
  return pool;
}

async function initSqlite() {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    const dbFile = process.env.SQLITE_DB_FILE || path.join(__dirname, 'db.sqlite');
    const db = new Database(dbFile);
    const convertPostgresPlaceholders = (sql, params = []) => {
      const convertedParams = [];
      const convertedSql = sql.replace(/\$(\d+)/g, (_, indexText) => {
        convertedParams.push(params[Number(indexText) - 1]);
        return '?';
      });

      return { convertedSql, convertedParams: convertedParams.length ? convertedParams : params };
    };

    const wrapper = {
      async query(sql, params = []) {
        try {
          const { convertedSql: converted, convertedParams } = convertPostgresPlaceholders(sql, params);
          const hasReturning = /RETURNING\s+/i.test(converted);
          if (hasReturning) {
            const withoutReturning = converted.replace(/RETURNING[\s\S]*$/i, '');
            const info = db.prepare(withoutReturning).run(...convertedParams);
            const lastId = info.lastInsertRowid;
            const rows = db.prepare('SELECT id, username, elo, wins, losses FROM users WHERE id = ?').all(lastId);
            return { rows };
          }

          if (/^\s*select/i.test(converted)) {
            const rows = db.prepare(converted).all(...convertedParams);
            return { rows };
          }

          const info = db.prepare(converted).run(...convertedParams);
          return { rows: [], info };
        } catch (err) {
          console.error('SQLite query error:', {
            message: err?.message,
            sql,
            convertedSql: typeof converted !== 'undefined' ? converted : null,
            params,
            convertedParams: typeof convertedParams !== 'undefined' ? convertedParams : null,
          });
          throw err;
        }
      },
      async close() {
        db.close();
      }
    };

    return wrapper;
  } catch (e) {
    console.warn('better-sqlite3 not available');
    if (process.env.NODE_ENV === 'production') {
      console.error('Production mode requires a persistent database. Set DATABASE_URL or install better-sqlite3.');
      throw e;
    }
    console.warn('Falling back to in-memory DB for local testing. This is NOT for production.');

    const data = {
      users: [],
      matches: [],
      achievements: [],
      friend_requests: [],
      friends: [],
      game_invites: [],
      nextUserId: 1,
      nextMatchId: 1,
      nextAchievementId: 1,
      nextFriendRequestId: 1,
      nextGameInviteId: 1,
    };

    const toRow = (u) => ({ id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses, password_hash: u.password_hash });

    return {
      async query(sql, params = []) {
        const s = sql.toLowerCase();
        if (s.includes('select') && s.includes('from users') && s.includes('where') && s.includes('username')) {
          const username = params[0];
          const found = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
          const rows = found ? [toRow(found)] : [];
          if (s.includes(' wlr')) {
            return { rows: rows.map((u) => ({ ...u, wlr: (u.wins || 0) / Math.max(1, u.losses || 0) })) };
          }
          return { rows };
        }

        if (s.includes('select') && s.includes('from users') && s.includes('where id')) {
          const id = params[0];
          const found = data.users.find((u) => u.id === id);
          return { rows: found ? [toRow(found)] : [] };
        }

        if (s.startsWith('insert') && s.includes('into users')) {
          const email = params[0];
          const username = params[1];
          const password_hash = params[2];
          const user = { id: data.nextUserId++, email, username, password_hash, elo: 1000, wins: 0, losses: 0, gamesPlayed: 0 };
          data.users.push(user);
          return { rows: [toRow(user)] };
        }

        if (s.startsWith('update users')) {
          if (s.includes('wins = case') && s.includes('where username')) {
            const username = params[0];
            const u = data.users.find((x) => x.username === username);
            if (u) u.wins = Math.max(u.wins || 0, 100);
            return { rows: [] };
          }
          const id = params[1] || params[0];
          const u = data.users.find((x) => x.id === id);
          if (!u) return { rows: [] };
          if (s.includes('set username')) u.username = params[0];
          if (s.includes('set password_hash')) u.password_hash = params[0];
          if (s.includes('wins = wins + 1')) u.wins = (u.wins || 0) + 1;
          if (s.includes('losses = losses + 1')) u.losses = (u.losses || 0) + 1;
          if (params && params.length) {
            const delta = params[0];
            if (typeof delta === 'number') u.elo = Math.max(0, (u.elo || 1000) + delta);
          }
          return { rows: [] };
        }

        if (s.includes('order by wlr') && s.includes('limit')) {
          const rows = data.users
            .map(toRow)
            .map((u) => ({ ...u, wlr: (u.wins || 0) / Math.max(1, u.losses || 0) }))
            .sort((a, b) => (b.wlr || 0) - (a.wlr || 0) || (b.wins || 0) - (a.wins || 0))
            .slice(0, 10);
          return { rows };
        }
        if (s.includes('order by wins') && s.includes('limit')) {
          const rows = data.users.map(toRow).sort((a, b) => (b.wins || 0) - (a.wins || 0)).slice(0, 10);
          return { rows };
        }
        if (s.includes('select') && s.includes('from users')) {
          const rows = data.users.map(toRow);
          if (s.includes(' wlr')) {
            return { rows: rows.map((u) => ({ ...u, wlr: (u.wins || 0) / Math.max(1, u.losses || 0) })) };
          }
          return { rows };
        }

        if (s.includes('select achievement_key') && s.includes('from achievements')) {
          const userId = params[0];
          return { rows: data.achievements.filter((a) => a.user_id === userId).map((a) => ({ achievement_key: a.achievement_key })) };
        }

        if (s.startsWith('insert') && s.includes('into achievements')) {
          const userId = params[0];
          const achievementKey = params[1];
          if (!data.achievements.some((a) => a.user_id === userId && a.achievement_key === achievementKey)) {
            data.achievements.push({ id: data.nextAchievementId++, user_id: userId, achievement_key: achievementKey });
          }
          return { rows: [] };
        }

        if (s.includes('select') && s.includes('from friend_requests')) {
          let rows = data.friend_requests.filter((fr) => {
            const wantsPending = s.includes(`'pending'`) || s.includes(`"pending"`);
            const statusOk = !wantsPending || fr.status === 'pending';

            if (s.includes('where fr.to_user_id = $1') && params[0]) {
              return fr.to_user_id === params[0] && statusOk;
            }
            if (s.includes('where fr.from_user_id = $1') && params[0]) {
              return fr.from_user_id === params[0] && statusOk;
            }
            return statusOk;
          });

          rows = rows.map((fr) => {
            let otherUserId;
            if (s.includes('where fr.to_user_id = $1')) otherUserId = fr.from_user_id;
            else if (s.includes('where fr.from_user_id = $1')) otherUserId = fr.to_user_id;
            else otherUserId = fr.from_user_id;

            const otherUser = data.users.find((u) => u.id === otherUserId);
            return {
              id: fr.id,
              from_user_id: fr.from_user_id,
              to_user_id: fr.to_user_id,
              username: otherUser?.username || 'Unknown',
              status: fr.status,
              created_at: fr.created_at
            };
          });
          return { rows };
        }

        if (s.startsWith('insert') && s.includes('into friend_requests')) {
          const fromUserId = params[0];
          const toUserId = params[1];
          const status = params[2];
          data.friend_requests.push({ id: data.nextFriendRequestId++, from_user_id: fromUserId, to_user_id: toUserId, status, created_at: new Date() });
          return { rows: [] };
        }

        if (s.startsWith('update friend_requests')) {
          const id = params[1] || params[2];
          const fr = data.friend_requests.find((r) => r.id === id);
          if (fr && params[0]) fr.status = params[0];
          return { rows: [] };
        }

        if (s.includes('select') && s.includes('from friends')) {
          const rows = data.friends.filter((f) => {
            if (params[0] && s.includes('where user_id')) return f.user_id === params[0];
            return true;
          }).map((f) => {
            const friend = data.users.find((u) => u.id === f.friend_id);
            return { id: f.friend_id, user_id: f.user_id, friend_id: f.friend_id, username: friend?.username, elo: friend?.elo, wins: friend?.wins, losses: friend?.losses };
          });
          return { rows };
        }

        if (s.startsWith('insert') && s.includes('into friends')) {
          const userId = params[0];
          const friendId = params[1];
          if (!data.friends.some((f) => f.user_id === userId && f.friend_id === friendId)) {
            data.friends.push({ user_id: userId, friend_id: friendId });
          }
          return { rows: [] };
        }

        if (s.startsWith('delete') && s.includes('from friends')) {
          const userId = params[0];
          const friendId = params[1];
          data.friends = data.friends.filter((f) => !((f.user_id === userId && f.friend_id === friendId) || (f.user_id === friendId && f.friend_id === userId)));
          return { rows: [] };
        }

        if (s.includes('select count') && s.includes('from friends')) {
          const userId = params[0];
          const count = data.friends.filter((f) => f.user_id === userId).length;
          return { rows: [{ count }] };
        }

        if (s.includes('select') && s.includes('from game_invites')) {
          let rows = data.game_invites.filter((gi) => {
            const wantsPending = s.includes(`'pending'`) || s.includes(`"pending"`);
            const wantsAccepted = s.includes(`'accepted'`) || s.includes(`"accepted"`);
            const statusOk = (!wantsPending && !wantsAccepted) || gi.status === 'pending' || gi.status === 'accepted';

            let typeOk = true;
            if (s.includes(`'private1v1'`)) typeOk = gi.invite_type === 'private1v1';
            else if (s.includes(`'private2v2'`)) typeOk = gi.invite_type === 'private2v2';
            else if (s.includes(`'online2v2'`)) typeOk = gi.invite_type === 'online2v2';

            if (s.includes('where gi.to_user_id = $1') && params[0]) {
              return gi.to_user_id === params[0] && statusOk && typeOk;
            }
            if (s.includes('where gi.from_user_id = $1') && params[0]) {
              return gi.from_user_id === params[0] && statusOk;
            }
            return statusOk && typeOk;
          });

          rows = rows.map((gi) => {
            let otherUserId;
            if (s.includes('where gi.to_user_id = $1')) otherUserId = gi.from_user_id;
            else if (s.includes('where gi.from_user_id = $1')) otherUserId = gi.to_user_id;
            else otherUserId = gi.from_user_id;

            const otherUser = data.users.find((u) => u.id === otherUserId);
            return {
              id: gi.id,
              from_user_id: gi.from_user_id,
              to_user_id: gi.to_user_id,
              username: otherUser?.username || 'Unknown',
              invite_type: gi.invite_type,
              status: gi.status,
              created_at: gi.created_at
            };
          });
          return { rows };
        }

        if (s.startsWith('insert') && s.includes('into game_invites')) {
          const fromUserId = params[0];
          const toUserId = params[1];
          const inviteType = params[2];
          const status = params[3];
          data.game_invites.push({ id: data.nextGameInviteId++, from_user_id: fromUserId, to_user_id: toUserId, invite_type: inviteType, status, created_at: new Date() });
          return { rows: [] };
        }

        if (s.startsWith('update game_invites')) {
          const status = params[0];
          const id = params[1];
          const gi = data.game_invites.find((r) => r.id === id);
          if (gi) gi.status = status;
          return { rows: [] };
        }

        return { rows: [] };
      },
      async close() {},
    };
  }
}

async function cleanupInvalidUsernames() {
  const result = await pool.query('SELECT id, username FROM users ORDER BY id');
  const rows = result.rows || [];
  const taken = new Set(rows.map((row) => String(row.username || '').trim().toLowerCase()));

  for (const row of rows) {
    const current = String(row.username || '').trim();
    if (isAllowedUsername(current)) continue;

    taken.delete(current.toLowerCase());
    const replacement = makeReplacementUsername(row.id, taken);
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [replacement, row.id]);
    taken.add(replacement.toLowerCase());
  }
}

export async function initializeDatabase() {
  try {
    if (USE_SQLITE) {
      pool = await initSqlite();
      const schemaPath = path.join(__dirname, 'schema.sql');
      let schema = fs.readFileSync(schemaPath, 'utf-8');
      schema = schema.replace(/SERIAL/g, 'INTEGER');
      schema = schema.replace(/TIMESTAMP DEFAULT NOW\(\)/g, "DATETIME DEFAULT (datetime('now'))");
      schema = schema.replace(/GREATEST\(/g, 'max(');
      const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await pool.query(stmt);
      }
      await cleanupInvalidUsernames();
      await ensureSpecialWins(pool);
      console.log('✓ SQLite database initialized');
    } else {
      await initPostgres();
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      const statements = schema.split(';').filter(s => s.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          await pool.query(statement);
        }
      }
      await cleanupInvalidUsernames();
      await ensureSpecialWins(pool);
      console.log('✓ Postgres database initialized');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

const exported = {
  async query(...args) {
    if (!pool) throw new Error('Database not initialized');
    return pool.query(...args);
  },
  async close() {
    if (!pool) return;
    if (typeof pool.close === 'function') return pool.close();
    if (typeof pool.end === 'function') return pool.end();
  }
};

export default exported;
