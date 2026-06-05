import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import { isAllowedUsername, makeReplacementUsername } from './usernameRules.js';

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

    const wrapper = {
      async query(sql, params = []) {
        try {
          const converted = sql.replace(/\$\d+/g, '?');
          const hasReturning = /RETURNING\s+/i.test(converted);
          if (hasReturning) {
            const withoutReturning = converted.replace(/RETURNING[\s\S]*$/i, '');
            const info = db.prepare(withoutReturning).run(...params);
            const lastId = info.lastInsertRowid;
            const rows = db.prepare('SELECT id, username, elo, wins, losses FROM users WHERE id = ?').all(lastId);
            return { rows };
          }

          if (/^\s*select/i.test(converted)) {
            const rows = db.prepare(converted).all(...params);
            return { rows };
          }

          const info = db.prepare(converted).run(...params);
          return { rows: [], info };
        } catch (err) {
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
      nextUserId: 1,
      nextMatchId: 1,
    };

    const toRow = (u) => ({ id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses, password_hash: u.password_hash });

    return {
      async query(sql, params = []) {
        const s = sql.toLowerCase();
        if (s.includes('select') && s.includes('from users') && s.includes('where username')) {
          const username = params[0];
          const found = data.users.find((u) => u.username === username);
          return { rows: found ? [toRow(found)] : [] };
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
          const id = params[1] || params[0];
          const u = data.users.find((x) => x.id === id);
          if (!u) return { rows: [] };
          if (s.includes('wins = wins + 1')) u.wins = (u.wins || 0) + 1;
          if (s.includes('losses = losses + 1')) u.losses = (u.losses || 0) + 1;
          if (params && params.length) {
            const delta = params[0];
            if (typeof delta === 'number') u.elo = Math.max(0, (u.elo || 1000) + delta);
          }
          return { rows: [] };
        }

        if (s.includes('order by elo') && s.includes('limit')) {
          const rows = data.users.map(toRow).sort((a, b) => b.elo - a.elo).slice(0, 10);
          return { rows };
        }
        if (s.includes('order by wins') && s.includes('limit')) {
          const rows = data.users.map(toRow).sort((a, b) => (b.wins || 0) - (a.wins || 0)).slice(0, 10);
          return { rows };
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
