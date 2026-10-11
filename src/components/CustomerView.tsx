import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { addDays, DOWF, keyFor, MONTHS, occurs, parse, toMin, weekStart, ymd } from '../../shared/dates';
import type { AdminUser, Task, User } from '../../shared/types';
import { DayView } from './DayView';
import { Goals } from './Goals';
import { NotifyForm } from './NotifyForm';
import { ago, Badges, fmtDate } from './adminBits';

interface Props {
  id: string;
  me: User;
  flash: (m: string) => void;
  onBack: () => void;
  /** Called after the customer was changed or deleted, so the list refreshes. */
  onChanged: () => void;
}

/** One customer's profile, admin actions, and a read-only view of their plan. */
export function CustomerView({ id, me, flash, onBack, onChanged }: Props) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sel, setSel] = useState(() => ymd(new Date()));
  const [busy, setBusy] = useState(false);
  const today = ymd(new Date());

  const load = useCallback(async () => {
    try {
      const r = await api.adminCustomer(id);
      setUser(r.user);
      setTasks(r.tasks);
    } catch (e) {
      flash((e as Error).message);
      onBack();
    }
  }, [id, flash, onBack]);

  useEffect(() => {
    load();
  }, [load]);

  const timed = useMemo(() => tasks.filter((t) => t.kind === 'timed'), [tasks]);
  const onDay = useCallback((ds: string) => timed.filter((t) => occurs(t, ds)).sort((a, b) => toMin(a.start!) - toMin(b.start!)), [timed]);

  if (!user) return <div className="card empty">Loading…</div>;

  const self = user.id === me.id, ad = user.role === 'admin', active = user.status === 'active';
  const act = async (fn: () => Promise<unknown>, msg: string, after: () => void = load) => {
    setBusy(true);
    try {
      await fn();
      flash(msg);
      onChanged();
      after();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = parse(sel), ws = weekStart(d), weekKey = ymd(ws), monthKey = sel.slice(0, 7);
  const goals = (kind: 'week' | 'month', key: string) => tasks.filter((t) => t.kind === kind && keyFor(t, t.date) === key);

  return (
    <div className="customer">
      <button className="back" onClick={onBack}><span className="ms">arrow_back</span>All customers</button>

      <div className="card customer-card">
        <div className="customer-head">
          <div className="user-avatar big">{user.name[0]?.toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name customer-name">{user.name}<Badges u={user} /></div>
            <a className="user-meta" href={`mailto:${user.email}`}>{user.email}</a>
          </div>
        </div>
        <div className="facts">
          <div><span>Joined</span>{fmtDate(user.created)}</div>
          <div><span>Last active</span>{user.lastActive ? ago(user.lastActive) : 'Never'}</div>
          <div><span>Tasks</span>{user.taskCount}</div>
          <div><span>Goals</span>{user.goalCount}</div>
          <div><span>Reminders</span>{user.devices ? `On · ${user.devices} ${user.devices === 1 ? 'device' : 'devices'}` : 'Off'}</div>
          <div><span>Tutorial</span>{user.onboarded ? 'Done' : 'Not yet'}</div>
        </div>
        {self ? (
          <div className="you">This is your account.</div>
        ) : (
          <div className="user-actions">
            <button disabled={busy} onClick={() => act(() => api.adminUpdate(user.id, { role: ad ? 'user' : 'admin' }), ad ? `${user.name} is now a user` : `${user.name} is now an admin`)}>{ad ? 'Make user' : 'Make admin'}</button>
            <button disabled={busy} onClick={() => act(() => api.adminUpdate(user.id, { status: active ? 'suspended' : 'active' }), active ? `${user.name} suspended` : `${user.name} activated`)}>{active ? 'Suspend' : 'Activate'}</button>
            <button className="danger" disabled={busy} onClick={() => confirm(`Delete ${user.name} and all their tasks?`) && act(() => api.adminDelete(user.id), `${user.name} deleted`, onBack)}>Delete</button>
          </div>
        )}
      </div>

      <div className="card goals">
        <div className="card-title" style={{ marginBottom: 12 }}>Send a notification</div>
        {user.devices ? (
          <NotifyForm userId={user.id} audience={user.name} flash={flash} />
        ) : (
          <div className="install-sub">{user.name} hasn’t turned on reminders on any device yet, so notifications can’t reach them.</div>
        )}
      </div>

      <div className="plan-head">
        <div>
          <div className="card-title">{self ? 'Your plan' : `${user.name.split(' ')[0]}’s plan`}</div>
          <div className="head-sub">{DOWF[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]}{sel === today ? ' · Today' : ''} · read-only</div>
        </div>
        <div className="head-nav">
          <button className="btn-outline" onClick={() => setSel(today)}>Today</button>
          <button className="btn-square" onClick={() => setSel(ymd(addDays(d, -1)))} aria-label="Previous day"><span className="ms">chevron_left</span></button>
          <button className="btn-square" onClick={() => setSel(ymd(addDays(d, 1)))} aria-label="Next day"><span className="ms">chevron_right</span></button>
        </div>
      </div>
      <DayView sel={sel} today={today} onDay={onDay} setSel={setSel} />
      <div className="customer-goals">
        <Goals title="Weekly goals" placeholder="" goals={goals('week', weekKey)} doneKey={weekKey} />
        <Goals title="Monthly goals" placeholder="" goals={goals('month', monthKey)} doneKey={monthKey} />
      </div>
    </div>
  );
}
