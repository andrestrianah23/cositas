import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { addDays, DOWF, keyFor, MONTHS, occurs, parse, toMin, weekStart, ymd } from '../shared/dates';
import type { Task, User } from '../shared/types';
import { AuthScreen } from './components/AuthScreen';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { Goals } from './components/Goals';
import { AdminView } from './components/AdminView';
import { SettingsView } from './components/SettingsView';
import { TaskSheet, type Draft } from './components/TaskSheet';
import { Nudge } from './components/Nudge';
import { forgetDevice, usePwa } from './pwa';

type View = 'day' | 'week' | 'month' | 'admin' | 'settings';

const CAL_VIEWS: [View, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function App() {
  const w = useWidth();
  const isWide = w >= 900;
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>('day');
  const [sel, setSel] = useState(() => ymd(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const today = ymd(new Date());
  const pwa = usePwa(!!me);

  const flash = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  const signedOut = useCallback(() => {
    setMe(null);
    setTasks([]);
    setDraft(null);
    setView('day');
  }, []);

  const enter = useCallback(async (u: User) => {
    setMe(u);
    setView('day');
    setSel(ymd(new Date()));
    try {
      setTasks((await api.tasks()).tasks);
    } catch (e) {
      flash((e as Error).message);
    }
  }, [flash]);

  useEffect(() => {
    setUnauthorizedHandler(signedOut);
    api.config().then((c) => setDemo(c.demo)).catch(() => {});
    api.me()
      .then(({ user }) => (user ? enter(user) : setMe(null)))
      .catch(() => setMe(null));
  }, [enter, signedOut]);

  const timed = useMemo(() => tasks.filter((t) => t.kind === 'timed'), [tasks]);
  const onDay = useCallback(
    (ds: string) => timed.filter((t) => occurs(t, ds)).sort((a, b) => toMin(a.start!) - toMin(b.start!)),
    [timed],
  );

  const replace = (t: Task) => setTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)));

  const toggle = async (t: Task, ds: string) => {
    const k = keyFor(t, ds);
    replace({ ...t, done: { ...t.done, [k]: !t.done[k] } });
    try {
      replace((await api.toggle(t.id, k)).task);
    } catch (e) {
      replace(t);
      flash((e as Error).message);
    }
  };

  const removeTask = async (t: Task) => {
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    try {
      await api.deleteTask(t.id);
      return true;
    } catch (e) {
      setTasks((ts) => [...ts, t]);
      flash((e as Error).message);
      return false;
    }
  };

  const addGoal = (kind: 'week' | 'month') => async (title: string) => {
    try {
      const { task } = await api.createGoal(kind, title, sel);
      setTasks((ts) => [...ts, task]);
      return true;
    } catch (e) {
      flash((e as Error).message);
      return false;
    }
  };

  const openSheet = (t: Task | null) =>
    setDraft(
      t
        ? { id: t.id, title: t.title, icon: t.icon!, color: t.color ?? 0, start: t.start!, dur: t.dur!, repeat: t.repeat ?? 'none', date: t.date }
        : { id: null, title: '', icon: 'alarm', color: 0, start: '09:00', dur: 30, repeat: 'none', date: sel },
    );

  const saveSheet = async ({ id, ...input }: Draft) => {
    try {
      if (id) replace((await api.updateTask(id, input)).task);
      else {
        const { task } = await api.createTask(input);
        setTasks((ts) => [...ts, task]);
      }
      setDraft(null);
      setSel(input.date);
      flash(id ? 'Task updated' : 'Task added');
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const deleteSheet = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (t && (await removeTask(t))) {
      setDraft(null);
      flash('Task deleted');
    }
  };

  const signOut = async () => {
    await forgetDevice();
    try {
      await api.signOut();
    } catch {
      // Signing out locally is still right if the request fails.
    }
    signedOut();
  };

  const shift = (dir: number) => {
    const d = parse(sel);
    const n = view === 'day' ? addDays(d, dir) : view === 'week' ? addDays(d, 7 * dir) : new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28));
    setSel(ymd(n));
  };

  if (me === undefined) {
    return <div className="shell loading"><img src="/logo-mark.png" alt="Loading Lockedin" /></div>;
  }

  if (!me) {
    return (
      <div className="shell">
        <AuthScreen isWide={isWide} demo={demo} onAuthed={(u, isNew) => { enter(u); if (isNew) flash('Welcome to Lockedin'); }} />
      </div>
    );
  }

  const admin = me.role === 'admin';
  const v: View = view === 'admin' && !admin ? 'day' : view;
  const isCal = v === 'day' || v === 'week' || v === 'month';
  const selD = parse(sel), ws = weekStart(selD), we = addDays(ws, 6);

  let hTitle = MONTHS[selD.getMonth()], hAccent = String(selD.getFullYear()), hSub = '';
  if (v === 'day') hSub = `${DOWF[selD.getDay()]} ${selD.getDate()}${sel === today ? ' · Today' : ''}`;
  if (v === 'week') hSub = `Week of ${ws.getDate()} ${MONTHS[ws.getMonth()].slice(0, 3)} – ${we.getDate()} ${MONTHS[we.getMonth()].slice(0, 3)}`;
  if (v === 'month') hSub = `${timed.length} scheduled tasks`;
  if (v === 'admin') [hTitle, hAccent, hSub] = ['Admin', 'panel', 'Manage accounts and see usage'];
  if (v === 'settings') [hTitle, hAccent, hSub] = ['Settings', '', ''];

  const nav: [View, string, string][] = [['day', 'Day', 'view_day'], ['week', 'Week', 'calendar_view_week'], ['month', 'Month', 'calendar_month']];
  if (admin) nav.push(['admin', 'Admin', 'admin_panel_settings']);
  nav.push(['settings', 'Settings', 'settings']);

  const pickDay = (ds: string) => {
    setSel(ds);
    setView('day');
  };
  const goalList = (kind: 'week' | 'month', key: string) => tasks.filter((t) => t.kind === kind && keyFor(t, t.date) === key);
  const weekKey = ymd(ws), monthKey = sel.slice(0, 7);

  return (
    <div className="shell">
      <div className="app">
        {isWide && (
          <aside className="sidebar">
            <div className="brand">
              <img src="/logo-mark.png" alt="Lockedin" width={36} height={36} style={{ borderRadius: 10 }} />
              <div className="brand-name" style={{ fontSize: 20 }}>Lockedin</div>
            </div>
            <nav className="side-nav">
              {nav.map(([k, label, icon]) => (
                <button key={k} className={v === k ? 'on' : ''} aria-current={v === k ? 'page' : undefined} onClick={() => setView(k)}>
                  <span className="ms">{icon}</span>{label}
                </button>
              ))}
            </nav>
            <div className="me-card">
              <div className="avatar">{me.name[0]?.toUpperCase()}</div>
              <div className="me-text">
                <div className="me-name">{me.name}</div>
                <div className="me-role">{admin ? 'Administrator' : 'Free plan'}</div>
              </div>
              <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><span className="ms">logout</span></button>
            </div>
          </aside>
        )}

        <main>
          <div className="page">
            <header className="head">
              <div className="head-text">
                <h1 className="head-title" style={{ fontSize: w < 480 ? 24 : 30, margin: 0 }}>
                  {hTitle} <span className="accent">{hAccent}</span>
                </h1>
                {hSub && <div className="head-sub">{hSub}</div>}
              </div>
              {isCal && (
                <div className="head-nav">
                  <button className="btn-outline" onClick={() => setSel(today)}>Today</button>
                  <button className="btn-square" onClick={() => shift(-1)} aria-label="Previous"><span className="ms">chevron_left</span></button>
                  <button className="btn-square" onClick={() => shift(1)} aria-label="Next"><span className="ms">chevron_right</span></button>
                </div>
              )}
            </header>

            {isCal && <Nudge pwa={pwa} flash={flash} />}

            {isCal && (
              <div className="seg view-tabs">
                {CAL_VIEWS.map(([k, label]) => (
                  <button key={k} className={v === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
                ))}
              </div>
            )}

            {v === 'day' && <DayView sel={sel} today={today} onDay={onDay} setSel={setSel} onEdit={openSheet} onToggle={toggle} />}

            {v === 'week' && (
              <>
                <WeekView sel={sel} today={today} isWide={isWide} onDay={onDay} pickDay={pickDay} onEdit={(t, ds) => { setSel(ds); openSheet(t); }} />
                <Goals title="Weekly goals" placeholder="Add a goal for this week" goals={goalList('week', weekKey)} doneKey={weekKey} onAdd={addGoal('week')} onToggle={(g) => toggle(g, g.date)} onDelete={removeTask} />
              </>
            )}

            {v === 'month' && (
              <>
                <MonthView sel={sel} today={today} isWide={isWide} onDay={onDay} pickDay={pickDay} />
                <Goals title="Monthly goals" placeholder="Add a goal for this month" goals={goalList('month', monthKey)} doneKey={monthKey} onAdd={addGoal('month')} onToggle={(g) => toggle(g, g.date)} onDelete={removeTask} />
              </>
            )}

            {v === 'admin' && <AdminView me={me} flash={flash} />}

            {v === 'settings' && (
              <SettingsView
                me={me}
                onUser={setMe}
                flash={flash}
                pwa={pwa}
                signOut={signOut}
              />
            )}
          </div>
        </main>

        {isCal && (
          <button className="fab" onClick={() => openSheet(null)} aria-label="Add task" style={{ bottom: isWide ? 28 : 'calc(96px + env(safe-area-inset-bottom))' }}>
            <span className="ms">add</span>
          </button>
        )}

        {!isWide && (
          <nav className="bottom-nav">
            {nav.map(([k, label, icon]) => (
              <button key={k} className={v === k ? 'on' : ''} aria-current={v === k ? 'page' : undefined} onClick={() => setView(k)}>
                <span className="ms">{icon}</span>{label}
              </button>
            ))}
          </nav>
        )}

        {draft && <TaskSheet draft={draft} isWide={isWide} onClose={() => setDraft(null)} onSave={saveSheet} onDelete={deleteSheet} flash={flash} />}

        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}
