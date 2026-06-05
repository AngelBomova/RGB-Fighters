import React, { useEffect, useState } from 'react';
import api from '../api';

export default function Leaderboard() {
  const [data, setData] = useState({ wins: [], elo: [] });

  useEffect(() => {
    let mounted = true;
    api.getLeaderboard().then((res) => {
      if (!mounted) return;
      setData(res);
    }).catch(() => {});
    return () => (mounted = false);
  }, []);

  return (
    <div className="p-6 bg-white rounded-2xl border max-w-4xl mx-auto">
      <h3 className="text-2xl mb-4">Leaderboards</h3>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="font-medium mb-2">Top by Wins</h4>
          <ol className="list-decimal pl-5">
            {data.wins.map((u, i) => (
              <li key={u.id} className="mb-1">{u.username} — {u.wins}W — {u.wins}W - {u.losses}L</li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="font-medium mb-2">Top by ELO</h4>
          <ol className="list-decimal pl-5">
            {data.elo.map((u, i) => (
              <li key={u.id} className="mb-1">{u.username} — {u.elo} ELO — {u.wins}W - {u.losses}L</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
