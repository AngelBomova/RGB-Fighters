import { io } from 'socket.io-client';
const rawSocketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const API_URL = String(rawSocketUrl).replace(/\/api\/?$/, '').replace(/\/$/, '');

export function createSocket(token) {
  const socket = io(API_URL, {
    auth: { token },
  });
  return socket;
}
