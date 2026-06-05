import { io } from 'socket.io-client';

const TOKEN = process.env.TEST_TOKEN || '';
if (!TOKEN) {
  console.error('Usage: TEST_TOKEN=... node server/testClient.mjs');
  process.exit(1);
}

const socket = io('http://localhost:3001', { auth: { token: TOKEN } });

socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('queue:join', { side: Math.random() > 0.5 ? 'left' : 'right' });
});

socket.on('queue:matched', (d) => {
  console.log('queue:matched', d);
});

socket.on('char:selectStart', (d) => {
  console.log('char:selectStart', d);
  // auto-select first color
  setTimeout(() => {
    socket.emit('char:selected', { matchId: d.matchId, character: 'red' });
    console.log('selected red');
  }, 1000);
});

socket.on('match:start', (d) => {
  console.log('match:start', d);
});

socket.on('input:opponent', (p) => console.log('input:opponent', p));
socket.on('match:result', (r) => { console.log('match:result', r); socket.disconnect(); process.exit(0); });
socket.on('opponent:disconnected', () => console.log('opponent:disconnected'));
socket.on('opponent:reconnected', () => console.log('opponent:reconnected'));

setTimeout(() => {
  console.log('test timeout, disconnecting');
  socket.disconnect();
  process.exit(0);
}, 30000);
