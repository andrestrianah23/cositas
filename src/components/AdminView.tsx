import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AdminStats, AdminUser, User } from '../../shared/types';
import { ago, Badges } from './adminBits';
import { CustomerView } from './CustomerView';
import { NotifyForm } from './NotifyForm';

export function AdminView({ me, flash }: { me: User; flash: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

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

  const back = useCallback(() => setOpen(null), []);

  if (open) return <CustomerView id={open} me={me} flash={flash} onBack={back} onChanged={load} />;

  const ql = q.trim().toLowerCase();
  const shown = users.filter((u) => !ql || u.name.toLowerCase().includes(ql) || u.email.includes(ql));
  const reachable = users.filter((u) => u.devices > 0 && u.status === 'active').length;
  const statList: [string, number | string][] = stats
    ? [['Total users', stats.totalUsers], ['Active', stats.activeUsers], ['New this week', stats.newThisWeek], ['Tasks & goals', stats.totalTasks]]
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

      <div className="card goals" style={{ marginBottom: 20 }}>
        <div className="goals-head" style={{ marginBottom: composing ? 12 : 0, alignItems: 'center' }}>
          <div>
            <div className="card-title">Message customers</div>
            <div className="goals-count">{reachable} {reachable === 1 ? 'customer has' : 'customers have'} reminders on and can receive notifications</div>
          </div>
          {!composing && <button className="btn-outline" onClick={() => setComposing(true)}><span className="ms inline">campaign</span> Write</button>}
        </div>
        {composing && <NotifyForm audience={`all ${reachable} ${reachable === 1 ? 'customer' : 'customers'} with reminders on`} flash={flash} />}
      </div>

      <div className="card users">
        <div className="users-head">
          <div className="card-title">Customers</div>
          <div className="users-tools">
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
            <a className="btn-outline csv" href="/api/admin/users.csv" download><span className="ms inline">download</span> CSV</a>
          </div>
        </div>
        {shown.map((u) => (
          <button className="user-row customer-row" key={u.id} onClick={() => setOpen(u.id)}>
            <div className="user-main">
              <div className="user-avatar">{u.name[0]?.toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="user-name">{u.name}<Badges u={u} />{u.id === me.id && <span className="you">You</span>}</div>
                <div className="user-meta">
                  {u.email} · {u.taskCount} tasks · {u.goalCount} goals · {u.lastActive ? `active ${ago(u.lastActive)}` : 'never opened'}
                  {u.devices > 0 && <> · <span className="ms inline small">notifications_active</span></>}
                </div>
              </div>
            </div>
            <span className="ms chev">chevron_right</span>
          </button>
        ))}
        {!shown.length && <div className="empty">{users.length ? 'No customers match your search.' : 'No customers yet.'}</div>}
      </div>
    </>
  );
}
