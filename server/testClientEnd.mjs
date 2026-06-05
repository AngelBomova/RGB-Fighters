import { io } from 'socket.io-client';

async function run(username, password) {
  // login to get token and id
  const res = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const token = body.token;
  const me = body.user;
  console.log('logged in', me.username, 'id', me.id);

  const socket = io('http://localhost:3001', { auth: { token } });

  socket.on('connect', () => {
    console.log(me.username, 'connected', socket.id);
    socket.emit('queue:join', { side: Math.random() > 0.5 ? 'left' : 'right' });
  });

  socket.on('queue:matched', (d) => console.log(me.username, 'queue:matched', d));

  socket.on('char:selectStart', (d) => {
    console.log(me.username, 'char:selectStart', d);
    setTimeout(() => {
      socket.emit('char:selected', { matchId: d.matchId, character: 'red' });
      console.log(me.username, 'selected red');
    }, 800);
  });

  socket.on('match:start', (d) => {
    console.log(me.username, 'match:start', d);
    // after short delay, send match:end claiming a 2-0 victory for this user
    setTimeout(() => {
      const payload = { matchId: d.matchId, p1Rounds: 2, p2Rounds: 0, winnerId: me.id };
      console.log(me.username, 'emitting match:end', payload);
      socket.emit('match:end', payload);
    }, 2000);
  });

  socket.on('match:result', (r) => {
    console.log(me.username, 'match:result', r);
    socket.disconnect();
    process.exit(0);
  });

  socket.on('match:ended', (r) => {
    console.log(me.username, 'match:ended', r);
    socket.disconnect();
    process.exit(0);
  });

  socket.on('opponent:disconnected', () => console.log(me.username, 'opponent:disconnected'));
  socket.on('opponent:reconnected', () => console.log(me.username, 'opponent:reconnected'));

  setTimeout(() => {
    console.log(me.username, 'test timeout, exiting');
    socket.disconnect();
    process.exit(0);
  }, 20000);
}

const args = process.argv.slice(2);
const username = args[0] || process.env.TEST_USER || 'test';
const password = args[1] || process.env.TEST_PASS || 'pass123';
run(username, password).catch((e) => { console.error('test client error', e); process.exit(1); });
