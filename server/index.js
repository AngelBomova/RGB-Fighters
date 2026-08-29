import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import pool, { initializeDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import leaderboardRoutes from './routes/leaderboard.js';
import achievementsRoutes, { unlockAchievement } from './routes/achievements.js';
import friendsRoutes from './routes/friends.js';
import { verifyToken, verifySocketToken } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);
const SERVER_VERSION = 'friends-reset-ai-path-v1';
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: SERVER_VERSION });
});

app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/friends', friendsRoutes);

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

app.post('/api/match/end', async (req, res) => {
  try {
    const { token, matchId, p1Rounds, p2Rounds, winnerId } = req.body || {};
    if (!token || !matchId) {
      return res.status(400).json({ ok: false, error: 'Missing token or matchId' });
    }

    const decoded = verifySocketToken(token);
    const match = activeMatches.get(matchId);
    if (!match) {
      return res.json({ ok: true, ended: false });
    }

    if (String(match.p1.userId) !== String(decoded.id) && String(match.p2.userId) !== String(decoded.id)) {
      return res.status(403).json({ ok: false, error: 'Not part of match' });
    }

    const finalP1Rounds = Number(p1Rounds) || 0;
    const finalP2Rounds = Number(p2Rounds) || 0;
    const finalWinnerId = winnerId || (finalP1Rounds > finalP2Rounds ? match.p1.userId : finalP2Rounds > finalP1Rounds ? match.p2.userId : null);
    await processMatchResult(matchId, finalP1Rounds, finalP2Rounds, finalWinnerId);
    return res.json({ ok: true, ended: true });
  } catch (err) {
    console.error('HTTP match end error:', err);
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

app.post('/api/match/state/:matchId', async (req, res) => {
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
  await recordMatchResultFromState(match.matchId, state).catch((err) => console.error('state result record err', err));
  return res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;

const matchmakingQueue = [];
const teamMatchmakingQueue = [];
const activeMatches = new Map();
const socketUserMap = new Map();
const privateInviteSessions = new Map();
const teamInviteSessions = new Map();
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 10000);
const STAGES = ['default', 'recursion', 'sky', 'hourglass', 'bottom'];
const BOT_NAMES = ['PixelRival', 'NeonByte', 'StageGhost', 'ComboBot', 'RGBCPU', 'LaglessLegend', 'PrismAI', 'OrbitBot'];
const BOT_CHARACTERS = ['red', 'blue', 'green', 'black', 'white', 'purple', 'yellow', 'orange', 'gray', 'brown', 'pink'];
const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'];
const randomStage = () => STAGES[Math.floor(Math.random() * STAGES.length)];
const randomChoice = (items) => items[Math.floor(Math.random() * items.length)];
const isBotPlayer = (player) => !!player?.bot;
const socketIdsForMatch = (match) => {
  if (Array.isArray(match?.players)) return match.players.map((player) => player.socketId).filter(Boolean);
  return [match?.p1?.socketId, match?.p2?.socketId].filter(Boolean);
};

function resolveMapVote(votes) {
  const counts = new Map();
  votes.filter((stage) => STAGES.includes(stage)).forEach((stage) => counts.set(stage, (counts.get(stage) || 0) + 1));
  if (!counts.size) return randomStage();
  const maxVotes = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, count]) => count === maxVotes).map(([stage]) => stage);
  return randomChoice(tied);
}

function emitToMatch(match, event, payloadFactory) {
  socketIdsForMatch(match).forEach((socketId) => {
    const payload = typeof payloadFactory === 'function' ? payloadFactory(socketId) : payloadFactory;
    io.to(socketId).emit(event, payload);
  });
}

async function forfeitMatch(matchId, leavingSocketId) {
  const match = activeMatches.get(matchId);
  if (!match) return false;

  if (match.mode === '2v2') {
    const leavingPlayer = match.players?.find((player) => player.socketId === leavingSocketId);
    const losingTeam = leavingPlayer?.team || 1;
    const winnerTeamText = losingTeam === 1 ? 'Team 2' : 'Team 1';
    try {
      await processMatchResult(matchId, winnerTeamText === 'Team 1' ? 2 : 0, winnerTeamText === 'Team 2' ? 2 : 0, null, winnerTeamText);
    } catch (err) {
      console.error('2v2 forfeit db err', err);
      return false;
    }
    emitToMatch(match, 'match:ended', { winnerTeam: winnerTeamText });
    return true;
  }

  const leavingIsP1 = match.p1.socketId === leavingSocketId;
  const winner = leavingIsP1 ? match.p2 : match.p1;
  const p1Rounds = leavingIsP1 ? 0 : 2;
  const p2Rounds = leavingIsP1 ? 2 : 0;

  try {
    await processMatchResult(matchId, p1Rounds, p2Rounds, winner.userId);
  } catch (err) {
    console.error('match forfeit db err', err);
    return false;
  }

  emitToMatch(match, 'match:ended', { winner: winner.userId || null });
  return true;
}

async function recordMatchResultFromState(matchId, state) {
  const match = activeMatches.get(matchId);
  if (!match || match.resultRecorded) return false;
  if (!state?.gameOver || !state?.matchWinnerText) return false;

  const team1Rounds = Number(state.team1Rounds) || 0;
  const team2Rounds = Number(state.team2Rounds) || 0;
  const p1Rounds = state.matchWinnerText === 'Team 1' ? Math.max(team1Rounds, 2) : team1Rounds;
  const p2Rounds = state.matchWinnerText === 'Team 2' ? Math.max(team2Rounds, 2) : team2Rounds;
  const winnerId = match.mode === '2v2'
    ? null
    : state.matchWinnerText === 'Team 1'
    ? match.p1.userId
    : state.matchWinnerText === 'Team 2'
      ? match.p2.userId || null
      : null;

  await processMatchResult(matchId, p1Rounds, p2Rounds, winnerId, state.matchWinnerText);
  return true;
}

async function processMatchResult(matchId, p1Rounds, p2Rounds, winnerId, winnerTeamText = '') {
  const match = activeMatches.get(matchId);
  if (!match) return false;
  if (match.resultRecorded) return true;
  match.resultRecorded = true;

  try {
    let eloChange = 0;
    let isP1Winner = false;
    const p1WonText = winnerTeamText === 'Team 1';
    const p2WonText = winnerTeamText === 'Team 2';

    if (match.private) {
      emitToMatch(match, 'match:result', (socketId) => {
        const player = match.players?.find((entry) => entry.socketId === socketId);
        const winner = player ? (player.team === 1 ? p1WonText : p2WonText) : socketId === match.p1?.socketId ? p1WonText : p2WonText;
        return { winner, newElo: 0, wins: undefined, losses: undefined, eloChange: 0 };
      });
      activeMatches.delete(matchId);
      return true;
    }

    if (match.mode === '2v2') {
      const team1Won = winnerTeamText === 'Team 1' || p1Rounds > p2Rounds;
      const humans = (match.players || []).filter((player) => player.userId && !player.bot);
      for (const player of humans) {
        const won = player.team === 1 ? team1Won : !team1Won;
        await pool.query(
          `UPDATE users SET ${won ? 'wins' : 'losses'} = ${won ? 'wins' : 'losses'} + 1 WHERE id = $1`,
          [player.userId]
        );
      }
      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1?.userId || null, match.p2?.userId || null, team1Won ? match.p1?.userId || null : null, p1Rounds, p2Rounds, 0]
      );
      for (const player of humans) {
        const recordResult = await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [player.userId]);
        const record = recordResult.rows?.[0] || { elo: 0, wins: 0, losses: 0 };
        if (player.socketId) {
          io.to(player.socketId).emit('match:result', {
            winner: player.team === 1 ? team1Won : !team1Won,
            newElo: record.elo,
            wins: record.wins,
            losses: record.losses,
            eloChange: 0,
          });
        }
      }
      activeMatches.delete(matchId);
      return true;
    }
    const p1IsBot = isBotPlayer(match.p1);
    const p2IsBot = isBotPlayer(match.p2);
    const p1Won = winnerTeamText === 'Team 1' || (!!winnerId && String(winnerId) === String(match.p1.userId));
    const p2Won = winnerTeamText === 'Team 2' || (!!winnerId && String(winnerId) === String(match.p2.userId));

    if (p1IsBot || p2IsBot) {
      isP1Winner = p1Won;
      const human = p1IsBot ? match.p2 : match.p1;
      const humanWon = p1IsBot ? p2Won : p1Won;
      const bot = p1IsBot ? match.p1 : match.p2;

      if (human?.userId) {
        await pool.query(
          `UPDATE users SET ${humanWon ? 'wins' : 'losses'} = ${humanWon ? 'wins' : 'losses'} + 1 WHERE id = $1`,
          [human.userId]
        );
        await pool.query(
          'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            p1IsBot ? null : match.p1.userId,
            p2IsBot ? null : match.p2.userId,
            humanWon ? human.userId : null,
            p1Rounds,
            p2Rounds,
            0,
          ]
        );
        if (humanWon && String(bot?.character || '').toLowerCase() === 'rainbow') {
          await unlockAchievement(human.userId, 'online:rainbow');
        }
      }
    } else if (!winnerId) {
      await pool.query(
        'UPDATE users SET losses = losses + 1 WHERE id = $1',
        [match.p1.userId]
      );
      await pool.query(
        'UPDATE users SET losses = losses + 1 WHERE id = $1',
        [match.p2.userId]
      );
      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1.userId, match.p2.userId, null, p1Rounds, p2Rounds, 0]
      );
    } else {
      isP1Winner = String(winnerId) === String(match.p1.userId);
      const winnerRounds = isP1Winner ? p1Rounds : p2Rounds;
      const loserRounds = isP1Winner ? p2Rounds : p1Rounds;
      eloChange = winnerRounds === 2 && loserRounds === 0 ? 20 : winnerRounds === 2 && loserRounds === 1 ? 10 : 0;

      if (isP1Winner) {
        await pool.query(
          'UPDATE users SET wins = wins + 1 WHERE id = $1',
          [match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET losses = losses + 1 WHERE id = $1',
          [match.p2.userId]
        );
      } else {
        await pool.query(
          'UPDATE users SET losses = losses + 1 WHERE id = $1',
          [match.p1.userId]
        );
        await pool.query(
          'UPDATE users SET wins = wins + 1 WHERE id = $1',
          [match.p2.userId]
        );
      }

      await pool.query(
        'INSERT INTO matches (player1_id, player2_id, winner_id, p1_rounds, p2_rounds, elo_change) VALUES ($1, $2, $3, $4, $5, $6)',
        [match.p1.userId, match.p2.userId, winnerId, p1Rounds, p2Rounds, eloChange]
      );

      const loserChar = String((isP1Winner ? match.p2Char : match.p1Char) || '').toLowerCase();
      if (loserChar === 'rainbow') {
        await unlockAchievement(winnerId, 'online:rainbow');
      }
    }

    const p1Data = match.p1.userId ? await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p1.userId]) : { rows: [] };
    const p2Data = match.p2.userId ? await pool.query('SELECT elo, wins, losses FROM users WHERE id = $1', [match.p2.userId]) : { rows: [] };
    const p1Record = p1Data.rows?.[0] || { elo: 0, wins: 0, losses: 0 };
    const p2Record = p2Data.rows?.[0] || { elo: 0, wins: 0, losses: 0 };

    if (match.p1.socketId) {
      io.to(match.p1.socketId).emit('match:result', {
        winner: p1Won,
        newElo: p1Record.elo,
        wins: p1Record.wins,
        losses: p1Record.losses,
        eloChange: winnerId ? (isP1Winner ? eloChange : -eloChange) : 0,
      });
    }

    if (match.p2.socketId) {
      io.to(match.p2.socketId).emit('match:result', {
        winner: p2Won,
        newElo: p2Record.elo,
        wins: p2Record.wins,
        losses: p2Record.losses,
        eloChange: winnerId ? (isP1Winner ? -eloChange : eloChange) : 0,
      });
    }

    console.log('Match result recorded:', {
      matchId,
      p1UserId: match.p1.userId,
      p2UserId: match.p2.userId,
      p1Rounds,
      p2Rounds,
      winnerId,
      p1Record,
      p2Record,
    });

    activeMatches.delete(matchId);
    return true;
    } catch (err) {
      match.resultRecorded = false;
      console.error('Match end error:', err);
      throw err;
    }
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

  const getOpponentStats = async (oppId, fallbackUsername = 'Player') => {
    if (!oppId) return { username: fallbackUsername, wins: 0, losses: 0 };
    const result = await pool.query(
      'SELECT username, wins, losses FROM users WHERE id = $1',
      [oppId]
    );
    return result.rows[0] || { username: fallbackUsername, wins: 0, losses: 0 };
  };

  const startSelectTimer = (matchId) => {
    const match = activeMatches.get(matchId);
    if (!match) return;

    emitToMatch(match, 'char:selectStart', (socketId) => ({
      timeLimit: 20000,
      matchId,
      side: socketId === match.p1.socketId ? 'left' : 'right',
      slot: socketId === match.p2.socketId ? 'p2' : 'p1',
      mode: match.mode === '2v2' ? 'online2v2' : 'online',
      requireMap: true,
      stages: STAGES,
    }));

    setTimeout(async () => {
      const current = activeMatches.get(matchId);
      if (!current || current.started) return;

      if (current.p1Ready && !current.p1Map) current.p1Map = randomStage();
      if (current.p2Ready && !current.p2Map) current.p2Map = randomStage();

      const p1Ready = !!current.p1Ready && !!current.p1Map;
      const p2Ready = !!current.p2Ready && !!current.p2Map;
      if (p1Ready && p2Ready) {
        maybeStartMatch(matchId);
        return;
      }

      if (current.private) {
        emitToMatch(current, 'char:forfeit', { reason: 'private-timeout' });
        activeMatches.delete(matchId);
        return;
      }

      if (!p1Ready && !p2Ready) {
        await processMatchResult(matchId, 0, 0, null).catch((e) => console.error('both timeout result err', e));
        emitToMatch(current, 'char:forfeit', { reason: 'both' });
        activeMatches.delete(matchId);
        return;
      }

      const winner = p1Ready ? current.p1 : current.p2;
      const p1Rounds = winner === current.p1 ? 2 : 0;
      const p2Rounds = winner === current.p2 ? 2 : 0;
      await processMatchResult(matchId, p1Rounds, p2Rounds, winner.userId || null, winner === current.p1 ? 'Team 1' : 'Team 2')
        .catch((e) => console.error('forfeit result err', e));
      emitToMatch(current, 'char:forfeit', { reason: 'no-character-or-map', winner: winner.userId || null });
      activeMatches.delete(matchId);
    }, 20000);
  };

  const maybeStartMatch = (matchId) => {
    const match = activeMatches.get(matchId);
    if (!match || match.started) return;
    if (!match.p1Ready || !match.p2Ready || !match.p1Map || !match.p2Map) return;

    match.stage = resolveMapVote([match.p1Map, match.p2Map]);
    match.started = true;

    if (match.mode === '2v2') {
      const common = {
        matchId,
        mode: 'online2v2',
        stage: match.stage,
        bot: true,
        p1Char: match.p1Char,
        p2Char: match.p2Char,
        e1Char: match.e1Char,
        e2Char: match.e2Char,
        p1UserId: match.p1.userId || null,
        p2UserId: match.p2.userId || null,
        p1Username: match.p1.username,
        p2Username: match.p2.username,
        e1Username: match.players?.[2]?.username || 'Bot E1',
        e2Username: match.players?.[3]?.username || 'Bot E2',
      };
      if (match.p1.socketId) {
        io.to(match.p1.socketId).emit('match:start', {
          ...common,
          side: 'left',
          slot: 'p1',
          host: true,
        });
      }
      if (match.p2.socketId) {
        io.to(match.p2.socketId).emit('match:start', {
          ...common,
          side: 'left',
          slot: 'p2',
          host: false,
        });
      }
      return;
    }

    const common = {
      matchId,
      p1Char: match.p1Char,
      p2Char: match.p2Char,
      p1UserId: match.p1.userId || null,
      p2UserId: match.p2.userId || null,
      p1Username: match.p1.username,
      p2Username: match.p2.username,
      stage: match.stage,
      bot: !!match.bot,
      botDifficulty: match.botDifficulty || null,
    };

    if (match.p1.socketId) {
      io.to(match.p1.socketId).emit('match:start', {
        ...common,
        side: 'left',
        host: true,
      });
    }
    if (match.p2.socketId) {
      io.to(match.p2.socketId).emit('match:start', {
        ...common,
        side: 'right',
        host: false,
      });
    }
  };

  const createOnline1v1Match = async (p1, p2, { bot = false, privateMatch = false } = {}) => {
    const matchId = `${p1.socketId || 'bot'}_${p2.socketId || 'bot'}_${Date.now()}`;
    const hostSocketId = p1.socketId || p2.socketId;

    activeMatches.set(matchId, {
      matchId,
      mode: '1v1',
      private: privateMatch,
      p1,
      p2,
      bot,
      botDifficulty: p2.bot ? p2.difficulty : p1.bot ? p1.difficulty : null,
      hostSocketId,
      p1Ready: !!p1.bot,
      p2Ready: !!p2.bot,
      p1Char: p1.bot ? p1.character : null,
      p2Char: p2.bot ? p2.character : null,
      p1Map: p1.bot ? p1.stage : null,
      p2Map: p2.bot ? p2.stage : null,
      stage: null,
      startTime: Date.now(),
      started: false,
    });

    const match = activeMatches.get(matchId);
    const p1Stats = await getOpponentStats(p1.userId, p1.username);
    const p2Stats = await getOpponentStats(p2.userId, p2.username);

    if (p1.socketId) {
      io.to(p1.socketId).emit('queue:matched', {
        matchId,
        opponent: { username: p2.username, wins: p2Stats.wins, losses: p2Stats.losses, bot: !!p2.bot },
        side: 'left',
        bot: !!p2.bot,
      });
    }
    if (p2.socketId) {
      io.to(p2.socketId).emit('queue:matched', {
        matchId,
        opponent: { username: p1.username, wins: p1Stats.wins, losses: p1Stats.losses, bot: !!p1.bot },
        side: 'right',
        bot: !!p1.bot,
      });
    }

    setTimeout(() => {
      const current = activeMatches.get(matchId);
      if (!current) return;
      startSelectTimer(matchId);
      maybeStartMatch(matchId);
    }, 600);

    return match;
  };

  const createBotOpponent = () => ({
    socketId: null,
    userId: null,
    username: randomChoice(BOT_NAMES),
    bot: true,
    character: randomChoice(BOT_CHARACTERS),
    difficulty: randomChoice(BOT_DIFFICULTIES),
    stage: randomStage(),
  });

  const createOnline2v2Match = async (teamPlayers, { privateMatch = false } = {}) => {
    const [p1, p2] = teamPlayers;
    const enemy1 = { ...createBotOpponent(), username: randomChoice(BOT_NAMES), team: 2, slot: 'e1' };
    const enemy2 = { ...createBotOpponent(), username: randomChoice(BOT_NAMES), team: 2, slot: 'e2' };
    const matchId = `2v2_${p1.socketId}_${p2.socketId}_${Date.now()}`;
    const hostSocketId = p1.socketId;
    const players = [
      { ...p1, team: 1, slot: 'p1' },
      { ...p2, team: 1, slot: 'p2' },
      enemy1,
      enemy2,
    ];

    activeMatches.set(matchId, {
      matchId,
      mode: '2v2',
      private: privateMatch,
      p1: players[0],
      p2: players[1],
      players,
      hostSocketId,
      bot: true,
      p1Ready: false,
      p2Ready: false,
      p1Char: null,
      p2Char: null,
      e1Char: enemy1.character,
      e2Char: enemy2.character,
      p1Map: null,
      p2Map: null,
      stage: null,
      startTime: Date.now(),
      started: false,
    });

    const p1Stats = await getOpponentStats(p1.userId, p1.username);
    const p2Stats = await getOpponentStats(p2.userId, p2.username);
    const match = activeMatches.get(matchId);

    io.to(p1.socketId).emit('queue:matched', {
      matchId,
      mode: 'online2v2',
      opponent: { username: `${enemy1.username} + ${enemy2.username}`, wins: 0, losses: 0, bot: true },
      teammate: { username: p2.username, wins: p2Stats.wins, losses: p2Stats.losses },
      side: 'left',
      slot: 'p1',
      bot: true,
    });
    io.to(p2.socketId).emit('queue:matched', {
      matchId,
      mode: 'online2v2',
      opponent: { username: `${enemy1.username} + ${enemy2.username}`, wins: 0, losses: 0, bot: true },
      teammate: { username: p1.username, wins: p1Stats.wins, losses: p1Stats.losses },
      side: 'left',
      slot: 'p2',
      bot: true,
    });

    setTimeout(() => {
      const current = activeMatches.get(matchId);
      if (!current) return;
      startSelectTimer(matchId);
      maybeStartMatch(matchId);
    }, 600);

    return match;
  };

  const queueTeamFor2v2 = async (teamPlayers, { privateMatch = false } = {}) => {
    if (privateMatch) {
      await createOnline2v2Match(teamPlayers, { privateMatch: true });
      return;
    }

    const queuedTeam = { teamPlayers, createdAt: Date.now() };
    queuedTeam.botTimer = setTimeout(async () => {
      const index = teamMatchmakingQueue.indexOf(queuedTeam);
      if (index === -1) return;
      teamMatchmakingQueue.splice(index, 1);
      await createOnline2v2Match(teamPlayers, { privateMatch: false }).catch((err) => console.error('2v2 bot match err', err));
    }, 15000);
    teamMatchmakingQueue.push(queuedTeam);
    teamPlayers.forEach((player) => {
      io.to(player.socketId).emit('team:queued', { waitMs: 15000 });
    });
  };

  socket.on('queue:join', async (data) => {
    const { side, mode = '1v1' } = data || {};
    const userId = socket.userId;
    const username = socket.username;
    socketUserMap.set(socket.id, { userId, username, side, mode });

    console.log(`${username} (${socket.id}) joined queue, side: ${side}, mode: ${mode}`);

    if (mode !== '1v1') {
      socket.emit('match:error', { error: 'Use a 2v2 Online friend invite, then Join Team Queue.' });
      return;
    }

    const queuePlayer = { socketId: socket.id, userId, username, side, mode };
    const opponentIndex = matchmakingQueue.findIndex((player) => player.mode === mode && player.socketId !== socket.id);
    if (opponentIndex !== -1) {
      const opponent = matchmakingQueue.splice(opponentIndex, 1)[0];
      if (opponent.botTimer) clearTimeout(opponent.botTimer);
      await createOnline1v1Match(opponent, queuePlayer);
    } else {
      queuePlayer.botTimer = setTimeout(async () => {
        const index = matchmakingQueue.findIndex((player) => player.socketId === socket.id);
        if (index === -1) return;
        const [waitingPlayer] = matchmakingQueue.splice(index, 1);
        await createOnline1v1Match(waitingPlayer, createBotOpponent(), { bot: true }).catch((err) => console.error('bot match err', err));
      }, 15000);
      matchmakingQueue.push(queuePlayer);
    }
  });

  socket.on('private:join', async (data) => {
    try {
      const inviteId = Number(data?.inviteId);
      if (!inviteId) return socket.emit('match:error', { error: 'Missing invite id' });

      const result = await pool.query(
        `SELECT gi.id, gi.invite_type, gi.from_user_id, gi.to_user_id, gi.status, gi.created_at,
                from_user.username AS from_username,
                to_user.username AS to_username
         FROM game_invites gi
         JOIN users from_user ON from_user.id = gi.from_user_id
         JOIN users to_user ON to_user.id = gi.to_user_id
         WHERE gi.id = $1`,
        [inviteId]
      );
      const invite = result.rows?.[0];
      if (!invite || invite.status !== 'accepted') return socket.emit('match:error', { error: 'Invite is not accepted yet' });
      if (Date.now() - new Date(invite.created_at || Date.now()).getTime() > 60000) {
        await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['expired', inviteId]);
        return socket.emit('match:error', { error: 'Invite expired' });
      }
      if (invite.invite_type !== 'private1v1') return socket.emit('match:error', { error: 'This invite type is not ready for match launch yet' });
      if (Number(socket.userId) !== Number(invite.from_user_id) && Number(socket.userId) !== Number(invite.to_user_id)) {
        return socket.emit('match:error', { error: 'You are not part of this invite' });
      }

      const session = privateInviteSessions.get(inviteId) || {
        invite,
        participants: new Map(),
      };
      session.participants.set(Number(socket.userId), {
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
        privateInviteId: inviteId,
      });
      privateInviteSessions.set(inviteId, session);
      socket.emit('private:waiting', { inviteId });

      const fromPlayer = session.participants.get(Number(invite.from_user_id));
      const toPlayer = session.participants.get(Number(invite.to_user_id));
      if (!fromPlayer || !toPlayer) return;

      privateInviteSessions.delete(inviteId);
      await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['consumed', inviteId]);
      await createOnline1v1Match(
        { ...fromPlayer, username: invite.from_username },
        { ...toPlayer, username: invite.to_username },
        { privateMatch: true }
      );
    } catch (err) {
      console.error('private join error', err);
      socket.emit('match:error', { error: 'Could not join private match' });
    }
  });

  socket.on('team:join', async (data) => {
    try {
      const inviteId = Number(data?.inviteId);
      if (!inviteId) return socket.emit('match:error', { error: 'Missing invite id' });

      const result = await pool.query(
        `SELECT gi.id, gi.invite_type, gi.from_user_id, gi.to_user_id, gi.status, gi.created_at,
                from_user.username AS from_username,
                to_user.username AS to_username
         FROM game_invites gi
         JOIN users from_user ON from_user.id = gi.from_user_id
         JOIN users to_user ON to_user.id = gi.to_user_id
         WHERE gi.id = $1`,
        [inviteId]
      );
      const invite = result.rows?.[0];
      if (!invite || invite.status !== 'accepted') return socket.emit('match:error', { error: 'Invite is not accepted yet' });
      if (Date.now() - new Date(invite.created_at || Date.now()).getTime() > 60000) {
        await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['expired', inviteId]);
        return socket.emit('match:error', { error: 'Invite expired' });
      }
      if (!['private2v2', 'online2v2'].includes(invite.invite_type)) {
        return socket.emit('match:error', { error: 'This is not a 2v2 invite' });
      }
      if (Number(socket.userId) !== Number(invite.from_user_id) && Number(socket.userId) !== Number(invite.to_user_id)) {
        return socket.emit('match:error', { error: 'You are not part of this invite' });
      }

      const session = teamInviteSessions.get(inviteId) || {
        invite,
        participants: new Map(),
      };
      session.participants.set(Number(socket.userId), {
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
        teamInviteId: inviteId,
      });
      teamInviteSessions.set(inviteId, session);
      socket.emit('team:waiting', { inviteId, inviteType: invite.invite_type });

      const fromPlayer = session.participants.get(Number(invite.from_user_id));
      const toPlayer = session.participants.get(Number(invite.to_user_id));
      if (!fromPlayer || !toPlayer) return;

      teamInviteSessions.delete(inviteId);
      await pool.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['consumed', inviteId]);
      await queueTeamFor2v2(
        [
          { ...fromPlayer, username: invite.from_username },
          { ...toPlayer, username: invite.to_username },
        ],
        { privateMatch: invite.invite_type === 'private2v2' }
      );
    } catch (err) {
      console.error('team join error', err);
      socket.emit('match:error', { error: 'Could not join 2v2 team' });
    }
  });

  socket.on('char:selected', (data) => {
    const { matchId, character } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;

    // ensure socket is participant
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;

    const isP1 = socket.id === match.p1.socketId;
    const playerUsername = isP1 ? match.p1.username : match.p2.username;
    const selectedCharacter = playerUsername === 'Rainbow'
      ? 'rainbow'
      : playerUsername === 'Monochrome'
        ? 'monochrome'
        : playerUsername === 'Transparent'
          ? 'transparent'
          : character;
    if (isP1) {
      match.p1Char = selectedCharacter;
      match.p1Ready = true;
      if (match.p2.socketId) io.to(match.p2.socketId).emit('opponent:charSelected', { character: selectedCharacter, slot: 'p1' });
    } else {
      match.p2Char = selectedCharacter;
      match.p2Ready = true;
      if (match.p1.socketId) io.to(match.p1.socketId).emit('opponent:charSelected', { character: selectedCharacter, slot: 'p2' });
    }

    maybeStartMatch(matchId);
  });

  socket.on('map:selected', (data) => {
    const { matchId, stage } = data || {};
    const match = activeMatches.get(matchId);
    if (!match || !STAGES.includes(stage)) return;
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;

    if (socket.id === match.p1.socketId) {
      match.p1Map = stage;
      if (match.p2.socketId) io.to(match.p2.socketId).emit('opponent:mapSelected', { stage });
    } else {
      match.p2Map = stage;
      if (match.p1.socketId) io.to(match.p1.socketId).emit('opponent:mapSelected', { stage });
    }

    maybeStartMatch(matchId);
  });

  socket.on('input:send', (data) => {
    const { matchId, inputs } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;

    if (match.mode === '2v2') {
      const player = match.players?.find((entry) => entry.socketId === socket.id);
      if (!player) return;
      socketIdsForMatch(match).forEach((socketId) => {
        if (socketId !== socket.id) io.to(socketId).emit('input:opponent', { matchId, inputs, slot: player.slot });
      });
      return;
    }

    // only accept inputs from participants
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) return;

    // relay inputs to opponent
    const isP1 = socket.id === match.p1.socketId;
    if (isP1) {
      if (match.p2.socketId) io.to(match.p2.socketId).emit('input:opponent', { matchId, inputs });
    } else {
      if (match.p1.socketId) io.to(match.p1.socketId).emit('input:opponent', { matchId, inputs });
    }
  });

  socket.on('state:sync', (data) => {
    const { matchId, state } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) return;
    const isAuthority = socket.id === match.hostSocketId || socket.id === match.p1.socketId;
    if (!isAuthority) return;
    match.latestState = state;
    if (match.p1.socketId) io.to(match.p1.socketId).emit('state:sync', { matchId, state });
    if (match.p2.socketId) io.to(match.p2.socketId).emit('state:sync', { matchId, state });
    recordMatchResultFromState(matchId, state).catch((err) => console.error('socket state result record err', err));
  });

  socket.on('queue:cancel', () => {
    const idx = matchmakingQueue.findIndex((p) => p.socketId === socket.id);
    if (idx !== -1) {
      const [queued] = matchmakingQueue.splice(idx, 1);
      if (queued?.botTimer) clearTimeout(queued.botTimer);
      socket.emit('queue:cancelled');
    }
    const teamIndex = teamMatchmakingQueue.findIndex((entry) => entry.teamPlayers?.some((player) => player.socketId === socket.id));
    if (teamIndex !== -1) {
      const [queuedTeam] = teamMatchmakingQueue.splice(teamIndex, 1);
      if (queuedTeam?.botTimer) clearTimeout(queuedTeam.botTimer);
      queuedTeam.teamPlayers?.forEach((player) => {
        if (player.socketId) io.to(player.socketId).emit('queue:cancelled');
      });
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

  socket.on('match:end', async (data, ack) => {
    const { matchId, p1Rounds, p2Rounds, winnerId } = data || {};
    const match = activeMatches.get(matchId);
    if (!match) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    if (socket.id !== match.p1.socketId && socket.id !== match.p2.socketId) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    const finalWinnerId = winnerId || (p1Rounds > p2Rounds ? match.p1.userId : p2Rounds > p1Rounds ? match.p2.userId : null);
    try {
      await processMatchResult(matchId, p1Rounds, p2Rounds, finalWinnerId, p1Rounds > p2Rounds ? 'Team 1' : p2Rounds > p1Rounds ? 'Team 2' : '');
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('match:end process err', err);
      if (typeof ack === 'function') ack({ ok: false });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const queueIndex = matchmakingQueue.findIndex((p) => p.socketId === socket.id);
    if (queueIndex !== -1) {
      const [queued] = matchmakingQueue.splice(queueIndex, 1);
      if (queued?.botTimer) clearTimeout(queued.botTimer);
    }
    const teamQueueIndex = teamMatchmakingQueue.findIndex((entry) => entry.teamPlayers?.some((player) => player.socketId === socket.id));
    if (teamQueueIndex !== -1) {
      const [queuedTeam] = teamMatchmakingQueue.splice(teamQueueIndex, 1);
      if (queuedTeam?.botTimer) clearTimeout(queuedTeam.botTimer);
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
      console.log(`Server version: ${SERVER_VERSION}`);
      console.log(`CORS enabled for: ${configuredFrontendUrl} and local dev ports`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
