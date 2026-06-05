import React, { useState } from 'react';
import api from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('login');

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      localStorage.setItem('rgb_token', res.token);
      onLogin(res.user, res.token);
    } catch (err) {
      setError(err.error || 'Request failed');
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-2xl border">
      <h3 className="text-xl mb-4">{mode === 'login' ? 'Login' : 'Sign Up'}</h3>
      <form onSubmit={submit} className="space-y-3">
        <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={12} placeholder="Username" className="w-full p-2 border rounded" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" className="w-full p-2 border rounded" />
        {error && <div className="text-red-500">{error}</div>}
        {mode === 'register' && <div className="text-xs text-gray-500">Usernames can be up to 12 characters.</div>}
        <div className="flex gap-2">
          <button className="bg-gray-900 text-white px-4 py-2 rounded">{mode === 'login' ? 'Login' : 'Create Account'}</button>
          <button type="button" className="px-4 py-2 border rounded" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Switch to Sign Up' : 'Switch to Login'}</button>
        </div>
      </form>
    </div>
  );
}
