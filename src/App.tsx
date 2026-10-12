import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { addDays, DOWF, isYmd, keyFor, MONTHS, occurs, parse, toMin, weekStart, ymd } from '../shared/dates';
import { goalInPeriod } from '../shared/goals';
import type { GoalInput, Task, User } from '../shared/types';
import { AuthScreen } from './components/AuthScreen';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { Goals } from './components/Goals';
import { AdminView } from './components/AdminView';
import { SettingsView } from './components/SettingsView';
import { TaskSheet, type Draft } from './components/TaskSheet';
import { Nudge } from './components/Nudge';
import { Tour } from './components/Tour';
import { GoalSheet } from './components/GoalSheet';
import { Landing } from './components/Landing';
import { ProgressView } from './components/ProgressView';
import { forgetDevice, usePwa } from './pwa';

type View = 'day' | 'week' | 'month' | 'progress' | 'admin' | 'settings';

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

type AuthMode = 'signin' | 'signup' | null;

/** Notifications open /?day=YYYY-MM-DD (that day) or /?view=progress (the weekly review). */
function openFromUrl(url: URL, setSel: (d: string) => void, setView: (v: View) => void) {
  const day = url.searchParams.get('day');
  if (isYmd(day)) {
    setSel(day);
    setView('day');
  }
  if (url.searchParams.get('view') === 'progress') setView('progress');
}
const hashMode = (): AuthMode => (location.hash === '#signin' ? 'signin' : location.hash === '#signup' ? 'signup' : null);

function openAuth(m: 'signin' | 'signup', set: (m: AuthMode) => void) {
  history.pushState(null, '', `#${m}`);
  set(m);
  window.scrollTo(0, 0);
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
  const [goalDraft, setGoalDraft] = useState<Task | null>(null);
  const [toast, setToast] = useState('');
  const [touring, setTouring] = useState(false);
  // Signed-out visitors see the landing page; #signin / #signup open the form (so the back button returns home).
  const [authMode, setAuthMode] = useState(hashMode);
  useEffect(() => {
    const onPop = () => setAuthMode(hashMode());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const signedIn = useRef(false);
  const reloadTasks = useCallback(async () => {
    if (!signedIn.current) return;
    try {
      setTasks((await api.tasks()).tasks);
    } catch {
      // Offline or signed out: keep what's on screen.
    }
  }, []);

  // Messages from the service worker: a reminder was tapped while the app is open (jump to that day or screen),
  // or a task was ticked from a notification's Done button (refresh).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'refresh') return void reloadTasks();
      if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
      openFromUrl(new URL(e.data.url, location.origin), setSel, setView);
      reloadTasks();
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [reloadTasks]);

  // Coming back to the app (e.g. after ticking something from a notification or another device): refresh.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && reloadTasks();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reloadTasks]);
  const today = ymd(new Date());
  const pwa = usePwa(!!me);

  const flash = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  const signedOut = useCallback(() => {
    signedIn.current = false;
    setMe(null);
    setTasks([]);
    setDraft(null);
    setGoalDraft(null);
    setTouring(false);
    setView('day');
  }, []);

  const enter = useCallback(async (u: User) => {
    setMe(u);
    setView('day');
    setSel(ymd(new Date()));
    signedIn.current = true;
    openFromUrl(new URL(location.href), setSel, setView);
    const params = new URLSearchParams(location.search);
    if (params.has('day') || params.has('view')) history.replaceState(null, '', location.pathname + location.hash);
    // First sign-in on this account: walk them through the app.
    setTouring(!u.onboarded);
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
        ? { id: t.id, title: t.title, icon: t.icon!, color: t.color ?? 0, start: t.start!, dur: t.dur!, repeat: t.repeat ?? 'none', remind: t.remind ?? 0, date: t.date }
        : { id: null, title: '', icon: 'alarm', color: 0, start: '09:00', dur: 30, repeat: 'none', remind: 0, date: sel },
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
    return <div className="shell loading"><img src="/logo-mark.png" alt="Loading LockedIn" /></div>;
  }

  if (!me) {
    // The installed app opens straight to sign-in: whoever installed it has already seen the pitch.
    if (!authMode && !pwa.installed) {
      return <Landing isWide={isWide} onStart={(m) => openAuth(m, setAuthMode)} />;
    }
    return (
      <div className="shell">
        <AuthScreen
          key={authMode ?? 'signin'}
          isWide={isWide}
          demo={demo}
          initialMode={authMode ?? 'signin'}
          onBack={pwa.installed ? undefined : () => { history.replaceState(null, '', location.pathname); setAuthMode(null); window.scrollTo(0, 0); }}
          onAuthed={(u, isNew) => {
            history.replaceState(null, '', location.pathname);
            setAuthMode(null);
            enter(u);
            if (isNew) flash('Welcome to LockedIn');
          }}
        />
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
  if (v === 'progress') [hTitle, hAccent, hSub] = ['Your', 'progress', 'Keep showing up. It adds up.'];

  const nav: [View, string, string][] = [['day', 'Day', 'view_day'], ['week', 'Week', 'calendar_view_week'], ['month', 'Month', 'calendar_month'], ['progress', 'Progress', 'insights']];
  if (admin) nav.push(['admin', 'Admin', 'admin_panel_settings']);
  nav.push(['settings', 'Settings', 'settings']);

  const pickDay = (ds: string) => {
    setSel(ds);
    setView('day');
  };
  const goalList = (kind: 'week' | 'month', key: string) => tasks.filter((t) => t.kind === kind && goalInPeriod(t, key));
  const weekKey = ymd(ws), monthKey = sel.slice(0, 7);

  return (
    <div className="shell">
      <div className="app">
        {isWide && (
          <aside className="sidebar">
            <div className="brand">
              <img src="/logo-mark.png" alt="LockedIn" width={36} height={36} style={{ borderRadius: 10 }} />
              <div className="brand-name" style={{ fontSize: 20 }}>LockedIn</div>
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

            {isCal && !touring && <Nudge pwa={pwa} flash={flash} />}

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
                <Goals title="Weekly goals" placeholder="Add a goal for this week" goals={goalList('week', weekKey)} periodKey={weekKey} tasks={tasks} onAdd={addGoal('week')} onToggle={(g) => toggle(g, sel)} onEdit={setGoalDraft} onDelete={removeTask} />
              </>
            )}

            {v === 'month' && (
              <>
                <MonthView sel={sel} today={today} isWide={isWide} onDay={onDay} pickDay={pickDay} />
                <Goals title="Monthly goals" placeholder="Add a goal for this month" goals={goalList('month', monthKey)} periodKey={monthKey} tasks={tasks} onAdd={addGoal('month')} onToggle={(g) => toggle(g, sel)} onEdit={setGoalDraft} onDelete={removeTask} />
              </>
            )}

            {v === 'progress' && <ProgressView tasks={tasks} today={today} />}

            {v === 'admin' && <AdminView me={me} flash={flash} />}

            {v === 'settings' && (
              <SettingsView
                me={me}
                onUser={setMe}
                flash={flash}
                pwa={pwa}
                replayTour={() => setTouring(true)}
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

        {touring && (
          <Tour
            name={me.name}
            admin={admin}
            isWide={isWide}
            setView={setView}
            onDone={(addTask) => {
              setTouring(false);
              setView('day');
              if (addTask) openSheet(null);
              if (!me.onboarded) api.finishTutorial().then((r) => setMe(r.user)).catch(() => {});
            }}
          />
        )}

        {goalDraft && (
          <GoalSheet
            key={goalDraft.id}
            goal={goalDraft}
            tasks={tasks}
            isWide={isWide}
            flash={flash}
            onClose={() => setGoalDraft(null)}
            onSave={async (input: GoalInput) => {
              try {
                replace((await api.updateGoal(goalDraft.id, input)).task);
                setGoalDraft(null);
                flash('Goal saved');
              } catch (e) {
                flash((e as Error).message);
              }
            }}
            onDelete={async () => {
              if (await removeTask(goalDraft)) {
                setGoalDraft(null);
                flash('Goal deleted');
              }
            }}
          />
        )}

        {draft && <TaskSheet draft={draft} isWide={isWide} onClose={() => setDraft(null)} onSave={saveSheet} onDelete={deleteSheet} flash={flash} />}

        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}
