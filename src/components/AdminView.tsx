import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { MONTHS } from '../../shared/dates';
import type { AdminStats, AdminUser, User } from '../../shared/types';

export function AdminView({ me, flash }: { me: User; flash: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.adminOverview();
      setUsers(r.users);
      setStats(r.stats);
    } catch (e) {
      flash((e as Error).message);
    }
  }, [flash]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    try {
      await fn();
      flash(msg);
      await load();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ql = q.trim().toLowerCase();
  const shown = users.filter((u) => !ql || u.name.toLowerCase().includes(ql) || u.email.includes(ql));
  const statList = stats
    ? [
        ['Total users', stats.totalUsers],
        ['Active', stats.activeUsers],
        ['New this week', stats.newThisWeek],
        ['Tasks & goals', stats.totalTasks],
      ]
    : [['Total users', '–'], ['Active', '–'], ['New this week', '–'], ['Tasks & goals', '–']];

  return (
    <>
      <div className="stats">
        {statList.map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
      </div>
      <div className="card users">
        <div className="users-head">
          <div className="card-title">Users</div>
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
        </div>
        {shown.map((u) => {
          const ad = u.role === 'admin', active = u.status === 'active', self = u.id === me.id, dt = new Date(u.created);
          return (
            <div className="user-row" key={u.id}>
              <div className="user-main">
                <div className="user-avatar">{u.name[0]?.toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="user-name">
                    {u.name}
                    <span className="badge" style={{ background: ad ? 'oklch(0.94 0.04 290)' : '#f0ece7', color: ad ? 'oklch(0.42 0.14 290)' : '#5b544d' }}>{ad ? 'Admin' : 'User'}</span>
                    <span className="badge" style={{ background: active ? 'oklch(0.94 0.05 150)' : 'oklch(0.95 0.03 30)', color: active ? 'oklch(0.42 0.12 150)' : 'oklch(0.45 0.14 30)' }}>{active ? 'Active' : 'Suspended'}</span>
                  </div>
                  <div className="user-meta">{u.email} · {u.taskCount} tasks · joined {dt.getDate()} {MONTHS[dt.getMonth()].slice(0, 3)}</div>
                </div>
              </div>
              {self ? (
                <div className="you">You</div>
              ) : (
                <div className="user-actions">
                  <button disabled={busy === u.id} onClick={() => act(u.id, () => api.adminUpdate(u.id, { role: ad ? 'user' : 'admin' }), ad ? `${u.name} is now a user` : `${u.name} is now an admin`)}>{ad ? 'Make user' : 'Make admin'}</button>
                  <button disabled={busy === u.id} onClick={() => act(u.id, () => api.adminUpdate(u.id, { status: active ? 'suspended' : 'active' }), active ? `${u.name} suspended` : `${u.name} activated`)}>{active ? 'Suspend' : 'Activate'}</button>
                  <button className="danger" disabled={busy === u.id} onClick={() => confirm(`Delete ${u.name} and all their tasks?`) && act(u.id, () => api.adminDelete(u.id), `${u.name} deleted`)}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
