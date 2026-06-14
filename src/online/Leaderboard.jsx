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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-0">
        <div className="md:pr-6">
          <LeaderboardTable
            title="Top by Wins"
            rows={data.wins}
            valueHeader="Wins"
            valueFor={(user) => Number(user.wins) || 0}
          />
        </div>
        <div className="md:pl-6 md:border-l md:border-gray-200">
          <LeaderboardTable
            title="Top by WLR"
            rows={data.wlr}
            valueHeader="WLR"
            valueFor={formatWlr}
          />
        </div>
      </div>
    </div>
  );
}

function LeaderboardTable({ title, rows, valueHeader, valueFor }) {
  return (
    <div>
      <h4 className="font-medium mb-2 text-center">{title}</h4>
      <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full table-fixed text-sm border-collapse">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-16" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
            <th className="py-2 px-2 text-left border-r border-gray-200">#</th>
            <th className="py-2 px-2 text-left border-r border-gray-200">Name</th>
            <th className="py-2 px-2 text-right border-r border-gray-200">{valueHeader}</th>
            <th className="py-2 px-2 text-right">Record</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((user, index) => (
            <tr key={user.id || user.username}>
              <td className="py-2 px-2 border-r border-gray-100 text-gray-600">{index + 1}</td>
              <td className="py-2 px-2 border-r border-gray-100 truncate" title={user.username}>{user.username}</td>
              <td className="py-2 px-2 border-r border-gray-100 text-right whitespace-nowrap">{valueFor(user)}</td>
              <td className="py-2 px-2 text-right whitespace-nowrap">{Number(user.wins) || 0}W - {Number(user.losses) || 0}L</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
