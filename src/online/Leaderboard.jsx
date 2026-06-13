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
    <div className="p-6 bg-white rounded-2xl border max-w-5xl mx-auto">
      <h3 className="text-2xl mb-5 text-center">Leaderboards</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LeaderboardTable
          title="Top by Wins"
          rows={data.wins}
          valueHeader="Wins"
          valueFor={(user) => Number(user.wins) || 0}
        />
        <LeaderboardTable
          title="Top by WLR"
          rows={data.wlr}
          valueHeader="WLR"
          valueFor={formatWlr}
        />
      </div>
    </div>
  );
}

function LeaderboardTable({ title, rows, valueHeader, valueFor }) {
  return (
    <div>
      <h4 className="font-medium mb-2 text-center">{title}</h4>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-gray-500">
            <th className="py-2 text-left">#</th>
            <th className="py-2 text-left">Name</th>
            <th className="py-2 text-right">{valueHeader}</th>
            <th className="py-2 text-right">Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((user, index) => (
            <tr key={user.id || user.username} className="border-b last:border-0">
              <td className="py-2">{index + 1}</td>
              <td className="py-2">{user.username}</td>
              <td className="py-2 text-right">{valueFor(user)}</td>
              <td className="py-2 text-right">{Number(user.wins) || 0}W - {Number(user.losses) || 0}L</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
