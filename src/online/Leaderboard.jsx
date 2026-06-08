import React, { useEffect, useState } from 'react';
import api from '../api';

export default function Leaderboard() {
  const [data, setData] = useState({ wins: [], wlr: [] });

  const formatWlr = (user) => {
    const wins = Number(user.wins) || 0;
    const losses = Number(user.losses) || 0;
    const ratio = typeof user.wlr !== 'undefined' ? Number(user.wlr) : wins / Math.max(1, losses);
    return Number.isFinite(ratio) ? ratio.toFixed(2) : '0.00';
  };

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
            {data.wins.map((user) => (
              <li key={user.id || user.username} className="mb-1">
                {user.username} — {user.wins}W — {user.wins}W - {user.losses}L
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="font-medium mb-2">Top by WLR</h4>
          <ol className="list-decimal pl-5">
            {data.wlr.map((user) => (
              <li key={user.id || user.username} className="mb-1">
                {user.username} — {formatWlr(user)} WLR — {user.wins}W - {user.losses}L
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
