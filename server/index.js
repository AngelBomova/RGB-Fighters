import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import pool, { initializeDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import leaderboardRoutes from './routes/leaderboard.js';
import { verifyToken, verifySocketToken } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);
const configuredFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowSocketOrigin = (origin, callback) => {
  const allowed =
    !origin ||
    origin === configuredFrontendUrl ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

  callback(null, allowed);
};
const io = new Server(httpServer, {
  cors: {
    origin: allowSocketOrigin,
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.post('/api/match/leave', async (req, res) => {
  try {
    const { token, matchId } = req.body || {};
    if (!token || !matchId) {
      return res.status(400).json({ ok: false, error: 'Missing token or matchId' });
    }

    const decoded = verifySocketToken(token);
    const match = activeMatches.get(matchId);
    if (!match) {
      return res.json({ ok: true, ended: false });
    }

    const leavingSocketId =
      match.p1.userId === decoded.id ? match.p1.socketId : match.p2.userId === decoded.id ? match.p2.socketId : null;

    if (!leavingSocketId) {
      return res.status(403).json({ ok: false, error: 'Not part of match' });
    }

    await forfeitMatch(matchId, leavingSocketId);
    return res.json({ ok: true, ended: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/match/state/:matchId', (req, res) => {
  const match = activeMatches.get(req.params.matchId);
  if (!match || !match.latestState) {
    return res.status(404).json({ ok: false });
  }

  return res.json({ ok: true, matchId: match.matchId, state: match.latestState });
});

app.post('/api/match/state/:matchId', (req, res) => {
  const match = activeMatches.get(req.params.matchId);
  if (!match) {
    return res.status(404).json({ ok: false });
  }

  const { state } = req.body || {};
  if (!state) {
    return res.status(400).json({ ok: false });
  }

  match.latestState = state;
  io.to(match.p1.socketId).emit('state:sync', { matchId: match.matchId, state });
  io.to(match.p2.socketId).emit('state:sync', { matchId: match.matchId, state });
  return res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;

const matchmakingQueue = [];
const activeMatches = new Map();
const socketUserMap = new Map();
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 10000);
const STAGES = ['default', 'recursion', 'sky', 'hourglass', 'bottom'];
const randomStage = () => STAGES[Math.floor(Math.random() * STAGES.length)];

async function forfeitMatch(matchId, leavingSocketId) {
  const match = activeMatches.get(matchId);
  if (!match) return false;

  const leavingIsP1 = match.p1.socketId === leavingSocketId;
  const winner = leavingIsP1 ? match.p2 : match.p1;
  const loser = leavingIsP1 ? match.p1 : match.p2;
  const p1Rounds = leavingIsP1 ? 0 : 2;
  const p2Rounds = leavingIsP1 ? 2 : 0;

  try {
    const eloChange = calculateEloChange(2, 0);
    await pool.query(
      'UPDATE users SET wins = wins + 1, elo = CASE WHEN (elo + $1) < 0 THEN 0 ELSE (elo + $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
      [eloChange, winner.userId]
    );
    await pool.query(
      'UPDATE users SET losses = losses + 1, elo = CASE WHEN (elo + $1) < 0 THEN 0 ELSE (elo + $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
      [-eloChange, loser.userId]
    );
    await pool.query(
      'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1,$2,$3,$4,$5,$6)',
      [match.p1.userId, match.p2.userId, winner.userId, p1Rounds, p2Rounds, eloChange]
    );

    const p1Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p1.userId]);
    const p2Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p2.userId]);
    const p1Record = p1Data.rows?.[0] || {};
    const p2Record = p2Data.rows?.[0] || {};

    io.to(match.p1.socketId).emit('match:result', {
      winner: !leavingIsP1,
      reason: 'forfeit',
      newElo: p1Record.elo,
      wins: p1Record.wins,
      losses: p1Record.losses,
      eloChange: leavingIsP1 ? -eloChange : eloChange,
    });

    io.to(match.p2.socketId).emit('match:result', {
      winner: leavingIsP1,
      reason: 'forfeit',
      newElo: p2Record.elo,
      wins: p2Record.wins,
      losses: p2Record.losses,
      eloChange: leavingIsP1 ? eloChange : -eloChange,
    });
  } catch (err) {
    console.error('match forfeit db err', err);
  }

  io.to(match.p1.socketId).emit('match:ended', { winner: winner.userId });
  io.to(match.p2.socketId).emit('match:ended', { winner: winner.userId });
  activeMatches.delete(matchId);
  return true;
}

io.on('connection', (socket) => {
  // Verify socket auth token on connection
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      socket.emit('match:error', { error: 'No auth token' });
      socket.disconnect(true);
      return;
    }
    const decoded = verifySocketToken(token);
    socket.userId = decoded.id;
    socket.username = decoded.username;
  } catch (err) {
    console.log('Socket auth failed for', socket.id, err.message);
    socket.emit('match:error', { error: 'Invalid token' });
    socket.disconnect(true);
    return;
  }

  console.log(`Player connected: ${socket.id} (${socket.username})`);

  socket.on('queue:join', async (data) => {
    const { side } = data || {};
    const userId = socket.userId;
    const username = socket.username;
    socketUserMap.set(socket.id, { userId, username, side });

    console.log(`${username} (${socket.id}) joined queue, side: ${side}`);

    if (matchmakingQueue.length > 0) {
      const opponent = matchmakingQueue.shift();
      const matchId = `${opponent.socketId}_${socket.id}`;

      const p1 = opponent;
      const p2 = { socketId: socket.id, userId, username, side };
      const hostSocketId = p1.socketId;
      const stage = randomStage();

      activeMatches.set(matchId, {
        matchId,
        p1,
        p2,
        hostSocketId,
        p1Ready: false,
        p2Ready: false,
        p1Char: null,
        p2Char: null,
        stage,
        startTime: Date.now(),
      });

      const getOpponentStats = async (oppId) => {
        const result = await pool.query(
          'SELECT username, elo, wins FROM users WHERE id = $1',
          [oppId]
        );
        return result.rows[0] || { username: 'Player', elo: 1000, wins: 0 };
      };

      const oppStats1 = await getOpponentStats(p2.userId);
      const oppStats2 = await getOpponentStats(p1.userId);

      io.to(opponent.socketId).emit('queue:matched', {
        matchId,
        opponent: {
          username: p2.username,
          elo: oppStats1.elo,
          wins: oppStats1.wins,
        },
        side: 'left',
      });

      io.to(socket.id).emit('queue:matched', {
        matchId,
        opponent: {
          username: p1.username,
          elo: oppStats2.elo,
          wins: oppStats2.wins,
        },
        side: 'right',
      });

      // send character select start with matchId
      setTimeout(() => {
        io.to(opponent.socketId).emit('char:selectStart', { timeLimit: 20000, matchId });
        io.to(socket.id).emit('char:selectStart', { timeLimit: 20000, matchId });

        // after timeLimit, evaluate forfeit
        setTimeout(async () => {
          const match = activeMatches.get(matchId);
          if (!match) return;
          // determine forfeit: if one player didn't ready
          const p1Ready = !!match.p1Ready;
          const p2Ready = !!match.p2Ready;
          if (!p1Ready || !p2Ready) {
            // if both not ready, cancel match
            if (!p1Ready && !p2Ready) {
              await processMatchResult(matchId, 0, 0, null).catch((e) => console.error('both timeout result err', e));
              io.to(match.p1.socketId).emit('char:forfeit', { reason: 'both' });
              io.to(match.p2.socketId).emit('char:forfeit', { reason: 'both' });
              activeMatches.delete(matchId);
              return;
            }

            // one player forfeits
            const winner = p1Ready ? match.p1 : match.p2;
            const p1Rounds = winner.userId === match.p1.userId ? 2 : 0;
            const p2Rounds = winner.userId === match.p2.userId ? 2 : 0;

            await processMatchResult(matchId, p1Rounds, p2Rounds, winner.userId).catch((e) => console.error('forfeit result err', e));

            io.to(match.p1.socketId).emit('char:forfeit', { reason: 'no-character', winner: winner.userId });
            io.to(match.p2.socketId).emit('char:forfeit', { reason: 'no-character', winner: winner.userId });
            activeMatches.delete(matchId);
          }
        }, 20000);
      }, 2000);
    } else {
      matchmakingQueue.push({ socketId: socket.id, userId, username, side });
    }
  });

  socket.on('char:selected', (data) => {
    const { matchId, character } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;

    // ensure socket is participant
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;

    const isP1 = socket.id === match.p1.socketId;
    if (isP1) {
      match.p1Char = character;
      match.p1Ready = true;
      io.to(match.p2.socketId).emit('opponent:charSelected', { character });
    } else {
      match.p2Char = character;
      match.p2Ready = true;
      io.to(match.p1.socketId).emit('opponent:charSelected', { character });
    }

    if (match.p1Ready && match.p2Ready) {
      io.to(match.p1.socketId).emit('match:start', {
        matchId,
        p1Char: match.p1Char,
        p2Char: match.p2Char,
        p1UserId: match.p1.userId,
        p2UserId: match.p2.userId,
        p1Username: match.p1.username,
        p2Username: match.p2.username,
        side: 'left',
        stage: match.stage,
        host: match.hostSocketId === match.p1.socketId,
      });
      io.to(match.p2.socketId).emit('match:start', {
        matchId,
        p1Char: match.p1Char,
        p2Char: match.p2Char,
        p1UserId: match.p1.userId,
        p2UserId: match.p2.userId,
        p1Username: match.p1.username,
        p2Username: match.p2.username,
        side: 'right',
        stage: match.stage,
        host: match.hostSocketId === match.p2.socketId,
      });
    }
  });

  socket.on('input:send', (data) => {
    const { matchId, inputs } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;

    // only accept inputs from participants
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;

    // relay inputs to opponent
    const isP1 = socket.id === match.p1.socketId;
    if (isP1) {
      io.to(match.p2.socketId).emit('input:opponent', { matchId, inputs });
    } else {
      io.to(match.p1.socketId).emit('input:opponent', { matchId, inputs });
    }
  });

  socket.on('state:sync', (data) => {
    const { matchId, state } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;
    const isAuthority = socket.id === match.hostSocketId || socket.id === match.p1.socketId;
    if (!isAuthority) return;
    match.latestState = state;
    io.to(match.p1.socketId).emit('state:sync', { matchId, state });
    io.to(match.p2.socketId).emit('state:sync', { matchId, state });
  });

  socket.on('queue:cancel', () => {
    const idx = matchmakingQueue.findIndex((p) => p.socketId === socket.id);
    if (idx !== -1) {
      matchmakingQueue.splice(idx, 1);
      socket.emit('queue:cancelled');
    }
  });

  socket.on('match:leave', async () => {
    // voluntary leave -> forfeit
    for (const [matchId, match] of activeMatches.entries()) {
      if (match.p1.socketId === socket.id || match.p2.socketId === socket.id) {
        await forfeitMatch(matchId, socket.id);
      }
    }
  });

  socket.on('match:end', async (data) => {
    const { matchId, p1Rounds, p2Rounds, winnerId } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;
    const finalWinnerId = winnerId || (p1Rounds > p2Rounds ? match.p1.userId : p2Rounds > p1Rounds ? match.p2.userId : null);
    await processMatchResult(matchId, p1Rounds, p2Rounds, finalWinnerId).catch((err) => console.error('match:end process err', err));
  });

async function processMatchResult(matchId, p1Rounds, p2Rounds, winnerId) {
  const match = activeMatches.get(matchId);
  if (!match) return;

  try {
    let eloChange = 0;
    let isP1Winner = false;

    if (!winnerId) {
      await pool.query(
        'UPDATE users SET losses = losses + 1, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $1',
        [match.p1.userId]
      );
      await pool.query(
        'UPDATE users SET losses = losses + 1, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $1',
        [match.p2.userId]
      );
      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1.userId, match.p2.userId, null, p1Rounds, p2Rounds, 0]
      );
    } else {
      eloChange = Math.abs(calculateEloChange(p1Rounds, p2Rounds));
      isP1Winner = String(winnerId) === String(match.p1.userId);

      if (isP1Winner) {
        await pool.query(
          'UPDATE users SET wins = wins + 1, elo = CASE WHEN (elo + $1) < 0 THEN 0 ELSE (elo + $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
          [eloChange, match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET losses = losses + 1, elo = CASE WHEN (elo - $1) < 0 THEN 0 ELSE (elo - $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
          [eloChange, match.p2.userId]
        );
      } else {
        await pool.query(
          'UPDATE users SET losses = losses + 1, elo = CASE WHEN (elo - $1) < 0 THEN 0 ELSE (elo - $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
          [eloChange, match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET wins = wins + 1, elo = CASE WHEN (elo + $1) < 0 THEN 0 ELSE (elo + $1) END, gamesPlayed = COALESCE(gamesPlayed,0) + 1 WHERE id = $2',
          [eloChange, match.p2.userId]
        );
      }

      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1.userId, match.p2.userId, winnerId, p1Rounds, p2Rounds, eloChange]
      );
    }

    const p1Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p1.userId]);
    const p2Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p2.userId]);
    const p1Record = p1Data.rows?.[0] || {};
    const p2Record = p2Data.rows?.[0] || {};

    io.to(match.p1.socketId).emit('match:result', {
      winner: winnerId ? isP1Winner : null,
      newElo: p1Record.elo,
      wins: p1Record.wins,
      losses: p1Record.losses,
      eloChange: winnerId ? (isP1Winner ? eloChange : -eloChange) : 0,
    });

    io.to(match.p2.socketId).emit('match:result', {
      winner: winnerId ? !isP1Winner : null,
      newElo: p2Record.elo,
      wins: p2Record.wins,
      losses: p2Record.losses,
      eloChange: winnerId ? (isP1Winner ? -eloChange : eloChange) : 0,
    });

      activeMatches.delete(matchId);
    } catch (err) {
      console.error('Match end error:', err);
    }
  }

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const queueIndex = matchmakingQueue.findIndex((p) => p.socketId === socket.id);
    if (queueIndex !== -1) {
      matchmakingQueue.splice(queueIndex, 1);
    }

    for (const [matchId, match] of activeMatches.entries()) {
      if (match.p1.socketId === socket.id || match.p2.socketId === socket.id) {
        forfeitMatch(matchId, socket.id).catch((err) => console.error('disconnect forfeit err', err));
      }
    }

    socketUserMap.delete(socket.id);
  });
});

function calculateEloChange(p1Rounds, p2Rounds) {
  if (p1Rounds === 2 && p2Rounds === 0) return 20;
  if (p1Rounds === 2 && p2Rounds === 1) return 10;
  if (p1Rounds === 1 && p2Rounds === 2) return -10;
  if (p1Rounds === 0 && p2Rounds === 2) return -20;
  return 0;
}

async function start() {
  try {
    await initializeDatabase();
    console.log('Database ready');

    httpServer.listen(PORT, () => {
      console.log(`RGB Fighters server running on port ${PORT}`);
      console.log(`CORS enabled for: ${configuredFrontendUrl} and local dev ports`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
