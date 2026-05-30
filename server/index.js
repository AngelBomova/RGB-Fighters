import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import pool, { initializeDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import leaderboardRoutes from './routes/leaderboard.js';
import { verifyToken } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

const PORT = process.env.PORT || 3001;

const matchmakingQueue = [];
const activeMatches = new Map();
const socketUserMap = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('queue:join', async (data) => {
    const { userId, username, token, side } = data;
    socketUserMap.set(socket.id, { userId, username, side });

    console.log(`${username} (${socket.id}) joined queue, side: ${side}`);

    if (matchmakingQueue.length > 0) {
      const opponent = matchmakingQueue.shift();
      const matchId = `${opponent.socketId}_${socket.id}`;

      const p1 = opponent.side === 'left' ? opponent : { socketId: socket.id, userId, username, side };
      const p2 = opponent.side === 'left' ? { socketId: socket.id, userId, username, side } : opponent;

      activeMatches.set(matchId, {
        p1,
        p2,
        p1Ready: false,
        p2Ready: false,
        p1Char: null,
        p2Char: null,
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

      setTimeout(() => {
        io.to(opponent.socketId).emit('char:selectStart', { timeLimit: 20000 });
        io.to(socket.id).emit('char:selectStart', { timeLimit: 20000 });

        setTimeout(() => {
          const match = activeMatches.get(matchId);
          if (match && (!match.p1Ready || !match.p2Ready)) {
            io.to(opponent.socketId).emit('char:forfeit');
            io.to(socket.id).emit('char:forfeit');
            activeMatches.delete(matchId);
          }
        }, 20000);
      }, 2000);
    } else {
      matchmakingQueue.push({ socketId: socket.id, userId, username, side });
    }
  });

  socket.on('char:selected', (data) => {
    const { matchId, character } = data;
    const match = activeMatches.get(matchId);

    if (!match) return;

    const isP1 = socket.id === match.p1.socketId;
    if (isP1) {
      match.p1Char = character;
      match.p1Ready = true;
      io.to(match.p2.socketId).emit('opponent:charSelected');
    } else {
      match.p2Char = character;
      match.p2Ready = true;
      io.to(match.p1.socketId).emit('opponent:charSelected');
    }

    if (match.p1Ready && match.p2Ready) {
      io.to(match.p1.socketId).emit('match:start', {
        p1Char: match.p1Char,
        p2Char: match.p2Char,
        side: 'left',
      });
      io.to(match.p2.socketId).emit('match:start', {
        p1Char: match.p1Char,
        p2Char: match.p2Char,
        side: 'right',
      });
    }
  });

  socket.on('input:send', (data) => {
    const { matchId, inputs } = data;
    const match = activeMatches.get(matchId);

    if (!match) return;

    const isP1 = socket.id === match.p1.socketId;
    if (isP1) {
      io.to(match.p2.socketId).emit('input:opponent', inputs);
    } else {
      io.to(match.p1.socketId).emit('input:opponent', inputs);
    }
  });

  socket.on('match:end', async (data) => {
    const { matchId, p1Rounds, p2Rounds, winnerId } = data;
    const match = activeMatches.get(matchId);

    if (!match) return;

    try {
      const eloChange = calculateEloChange(p1Rounds, p2Rounds);
      const isP1Winner = winnerId === match.p1.userId;

      if (isP1Winner) {
        await pool.query(
          'UPDATE users SET wins = wins + 1, elo = GREATEST(0, elo + $1) WHERE id = $2',
          [eloChange, match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET losses = losses + 1, elo = GREATEST(0, elo + $1) WHERE id = $2',
          [-eloChange, match.p2.userId]
        );
      } else {
        await pool.query(
          'UPDATE users SET losses = losses + 1, elo = GREATEST(0, elo + $1) WHERE id = $2',
          [-eloChange, match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET wins = wins + 1, elo = GREATEST(0, elo + $1) WHERE id = $2',
          [eloChange, match.p2.userId]
        );
      }

      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1.userId, match.p2.userId, winnerId, p1Rounds, p2Rounds, eloChange]
      );

      const p1Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p1.userId]);
      const p2Data = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p2.userId]);

      io.to(match.p1.socketId).emit('match:result', {
        winner: isP1Winner,
        newElo: p1Data.rows[0].elo,
        eloChange,
      });

      io.to(match.p2.socketId).emit('match:result', {
        winner: !isP1Winner,
        newElo: p2Data.rows[0].elo,
        eloChange: -eloChange,
      });

      activeMatches.delete(matchId);
    } catch (err) {
      console.error('Match end error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const queueIndex = matchmakingQueue.findIndex((p) => p.socketId === socket.id);
    if (queueIndex !== -1) {
      matchmakingQueue.splice(queueIndex, 1);
    }

    for (const [matchId, match] of activeMatches.entries()) {
      if (match.p1.socketId === socket.id || match.p2.socketId === socket.id) {
        const opponentSocketId = match.p1.socketId === socket.id ? match.p2.socketId : match.p1.socketId;
        io.to(opponentSocketId).emit('opponent:disconnected');
        activeMatches.delete(matchId);
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
      console.log(`CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
