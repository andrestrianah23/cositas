import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, DOWF, fmtT, keyFor, MONTHS, occurs, parse, toMin, weekStart, ymd } from '../../shared/dates';
import type { Task } from '../../shared/types';
import { COLORS } from '../theme';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { Goals } from './Goals';
import { TaskSheet, type Draft } from './TaskSheet';
import '../landing.css';

type Start = (mode: 'signin' | 'signup') => void;

// ---------- Sample plan for the live demo (kept in memory only) ----------

function sampleTasks(today: string): Task[] {
  const first = ymd(addDays(parse(today), -7));
  const timed: [string, string, number, number, string, Task['repeat']][] = [
    ['Wake up', '07:00', 15, 0, 'alarm', 'daily'],
    ['Yoga', '07:15', 30, 1, 'self_improvement', 'daily'],
    ['Coffee & plan the day', '07:45', 15, 3, 'coffee', 'daily'],
    ['Deep work', '09:00', 120, 4, 'work', 'daily'],
    ['Lunch', '12:30', 45, 2, 'restaurant', 'daily'],
    ['Team sync', '14:00', 60, 6, 'groups', 'weekly'],
    ['Run', '18:00', 45, 7, 'directions_run', 'daily'],
    ['Read', '21:30', 30, 5, 'menu_book', 'daily'],
  ];
  const tasks: Task[] = timed.map(([title, start, dur, color, icon, repeat], i) => ({
    id: `demo-${i}`, kind: 'timed', title, date: first, start, dur, color, icon, repeat,
    done: i < 2 ? { [today]: true } : {},
  }));
  const goals: [string, 'week' | 'month'][] = [['Finish the project brief', 'week'], ['Call mom', 'week'], ['Pay rent', 'month'], ['Book the dentist', 'month']];
  goals.forEach(([title, kind], i) => tasks.push({ id: `goal-${i}`, kind, title, date: today, start: null, dur: null, color: null, icon: null, repeat: null, done: i === 1 ? { [keyFor({ kind }, today)]: true } : {} }));
  return tasks;
}

// ---------- Small interactive pieces ----------

/** Adds the `in` class to every `.reveal` element as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll('.reveal');
    if (!els?.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.18, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = () => {
      if (reduce) return setN(to);
      const t0 = performance.now(), ms = 1100;
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!('IntersectionObserver' in window)) return run();
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        run();
        io.disconnect();
      }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{n}{suffix}</span>;
}

const HERO_TASKS = [
  { t: '7:00', title: 'Wake up', icon: 'alarm', color: 0, h: 40 },
  { t: '7:15', title: 'Yoga', icon: 'self_improvement', color: 1, h: 56 },
  { t: '9:00', title: 'Deep work', icon: 'work', color: 4, h: 84 },
  { t: '12:30', title: 'Lunch', icon: 'restaurant', color: 2, h: 48 },
  { t: '18:00', title: 'Run', icon: 'directions_run', color: 7, h: 56 },
];

/** The phone in the hero: tick tasks, watch the progress bar, and see a reminder drop in. */
function HeroPhone() {
  const [done, setDone] = useState<Set<number>>(() => new Set([0]));
  const [now, setNow] = useState(() => new Date());
  const [banner, setBanner] = useState<number | null>(null);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(clock);
  }, []);

  // Every few seconds, the next unticked task "starts" and its reminder slides in.
  useEffect(() => {
    let k = 0;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const open = HERO_TASKS.map((_, i) => i).filter((i) => !done.has(i));
      if (!open.length) return setBanner(null);
      setBanner(open[k++ % open.length]);
      hide = setTimeout(() => setBanner(null), 3200);
    };
    const first = setTimeout(show, 1600);
    const loop = setInterval(show, 6500);
    return () => {
      clearTimeout(first);
      clearInterval(loop);
      clearTimeout(hide);
    };
  }, [done]);

  const toggle = (i: number) => setDone((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const pct = Math.round((done.size / HERO_TASKS.length) * 100);
  const clock = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="lp-phone" aria-label="Interactive preview of the LockedIn day view">
      <div className="lp-phone-notch" />
      <div className="lp-phone-status"><span>{clock}</span><span className="ms">signal_cellular_alt</span></div>
      <div className={`lp-banner${banner !== null ? ' show' : ''}`} aria-live="polite">
        {banner !== null && (
          <>
            <img src="/icon-192.png" alt="" />
            <div><strong>{HERO_TASKS[banner].title}</strong><span>Starting now · {HERO_TASKS[banner].t}</span></div>
          </>
        )}
      </div>
      <div className="lp-phone-head">
        <div className="lp-phone-title">{MONTHS[now.getMonth()]} <span>{now.getFullYear()}</span></div>
        <div className="lp-phone-sub">{DOWF[now.getDay()]} {now.getDate()} · Today</div>
      </div>
      <div className="lp-phone-card">
        <div className="progress">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <div className="progress-label mono">{done.size}/{HERO_TASKS.length}</div>
        </div>
        {HERO_TASKS.map((t, i) => {
          const on = done.has(i), c = COLORS[t.color];
          return (
            <div className="lp-mini" key={t.title}>
              <span className="lp-mini-time mono">{t.t}</span>
              <span className="lp-mini-tile" style={{ height: t.h, background: c, opacity: on ? 0.45 : 1 }}><span className="ms">{t.icon}</span></span>
              <span className={`lp-mini-title${on ? ' done' : ''}`}>{t.title}</span>
              <button className="check lp-mini-check" onClick={() => toggle(i)} aria-pressed={on} aria-label={on ? `Mark ${t.title} not done` : `Mark ${t.title} done`} style={{ borderColor: c, background: on ? c : 'transparent' }}>
                <span className="ms">{on ? 'check' : ''}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="lp-tap-hint"><span className="ms">touch_app</span>Tap a circle</div>
    </div>
  );
}

/** The real Day, Week and Month screens, running on a sample plan you can play with. */
function LiveDemo({ isWide }: { isWide: boolean }) {
  const today = ymd(new Date());
  const [tasks, setTasks] = useState(() => sampleTasks(today));
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [sel, setSel] = useState(today);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((m: string) => {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  const timed = useMemo(() => tasks.filter((t) => t.kind === 'timed'), [tasks]);
  const onDay = useCallback((ds: string) => timed.filter((t) => occurs(t, ds)).sort((a, b) => toMin(a.start!) - toMin(b.start!)), [timed]);
  const toggle = (t: Task, ds: string) => {
    const k = keyFor(t, ds);
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: { ...x.done, [k]: !x.done[k] } } : x)));
  };
  const edit = (t: Task) => setDraft({ id: t.id, title: t.title, icon: t.icon!, color: t.color ?? 0, start: t.start!, dur: t.dur!, repeat: t.repeat ?? 'none', date: t.date });
  const ws = weekStart(parse(sel)), weekKey = ymd(ws), monthKey = sel.slice(0, 7);
  const goals = (kind: 'week' | 'month', key: string) => tasks.filter((t) => t.kind === kind && keyFor(t, t.date) === key);
  const addGoal = (kind: 'week' | 'month') => async (title: string) => {
    setTasks((ts) => [...ts, { id: `goal-${Date.now()}`, kind, title, date: sel, start: null, dur: null, color: null, icon: null, repeat: null, done: {} }]);
    return true;
  };
  const shift = (dir: number) => {
    const d = parse(sel);
    setSel(ymd(view === 'day' ? addDays(d, dir) : view === 'week' ? addDays(d, 7 * dir) : new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28))));
  };

  return (
    <div className="lp-demo">
      <div className="lp-demo-bar">
        <div className="seg view-tabs" role="tablist">
          {(['day', 'week', 'month'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
        <div className="head-nav">
          <button className="btn-outline" onClick={() => setSel(today)}>Today</button>
          <button className="btn-square" onClick={() => shift(-1)} aria-label="Previous"><span className="ms">chevron_left</span></button>
          <button className="btn-square" onClick={() => shift(1)} aria-label="Next"><span className="ms">chevron_right</span></button>
        </div>
      </div>
      <div className="lp-demo-screen" key={view}>
        {view === 'day' && <DayView sel={sel} today={today} onDay={onDay} setSel={setSel} onEdit={edit} onToggle={toggle} />}
        {view === 'week' && (
          <>
            <WeekView sel={sel} today={today} isWide={isWide} onDay={onDay} pickDay={(ds) => { setSel(ds); setView('day'); }} onEdit={(t, ds) => { setSel(ds); edit(t); }} />
            <Goals title="Weekly goals" placeholder="Add a goal for this week" goals={goals('week', weekKey)} doneKey={weekKey} onAdd={addGoal('week')} onToggle={(g) => toggle(g, g.date)} onDelete={(g) => setTasks((ts) => ts.filter((x) => x.id !== g.id))} />
          </>
        )}
        {view === 'month' && (
          <>
            <MonthView sel={sel} today={today} isWide={isWide} onDay={onDay} pickDay={(ds) => { setSel(ds); setView('day'); }} />
            <Goals title="Monthly goals" placeholder="Add a goal for this month" goals={goals('month', monthKey)} doneKey={monthKey} onAdd={addGoal('month')} onToggle={(g) => toggle(g, g.date)} onDelete={(g) => setTasks((ts) => ts.filter((x) => x.id !== g.id))} />
          </>
        )}
      </div>
      <button className="fab lp-demo-fab" onClick={() => setDraft({ id: null, title: '', icon: 'alarm', color: 0, start: '10:00', dur: 30, repeat: 'none', date: sel })} aria-label="Add a task to the demo">
        <span className="ms">add</span>
      </button>
      {draft && (
        <TaskSheet
          draft={draft}
          isWide={isWide}
          flash={flash}
          onClose={() => setDraft(null)}
          onSave={async ({ id, ...input }) => {
            if (id) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...input } : t)));
            else setTasks((ts) => [...ts, { ...input, id: `demo-${Date.now()}`, kind: 'timed', done: {} }]);
            setDraft(null);
            setSel(input.date);
            setView('day');
            flash(id ? 'Task updated' : 'Task added to the demo');
          }}
          onDelete={async (id) => {
            setTasks((ts) => ts.filter((t) => t.id !== id));
            setDraft(null);
            flash('Task deleted');
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ---------- Page ----------

const FEATURES = [
  { icon: 'view_day', title: 'A timeline, not a to-do list', text: 'Every task is a block sized by how long it takes, so you see the shape of your day and the free time in it.' },
  { icon: 'repeat', title: 'Routines on repeat', text: 'Set a task once and repeat it every day, week or month. Your mornings plan themselves.' },
  { icon: 'flag', title: 'Goals for the week and month', text: 'Keep the bigger things, like “finish the brief” or “pay rent”, next to the days you’ll do them.' },
  { icon: 'notifications_active', title: 'Reminders at the right moment', text: 'A gentle notification the minute each task starts, even when the app is closed.' },
  { icon: 'install_mobile', title: 'Install in two taps', text: 'No app store needed. Add LockedIn to your home screen and it opens full screen like any app.' },
  { icon: 'devices', title: 'On every device', text: 'Plan on your laptop, tick things off on your phone. Your plan follows your account.' },
];

const FAQ = [
  { q: 'Is LockedIn really free?', a: 'Yes. Creating an account is free and there’s no card to enter.' },
  { q: 'Do I need to download it from an app store?', a: 'No. LockedIn runs in your browser. Add it to your home screen and it opens full screen like any other app on your phone.' },
  { q: 'Does it work on iPhone and Android?', a: 'Yes, on both, and on computers too. On iPhone, reminders need iOS 16.4 or later and LockedIn added to your Home Screen. The app walks you through it.' },
  { q: 'Will my plan be on all my devices?', a: 'Yes. Sign in on your phone and your computer and you’ll see the same plan everywhere.' },
  { q: 'How do reminders work?', a: 'Turn them on in the app and allow notifications. You’ll get one the moment each task starts. You can turn them off anytime in Settings.' },
  { q: 'Who can see my plans?', a: 'Your plan is tied to your account. The LockedIn team can view an account only to help with support.' },
];

const STEPS = [
  { icon: 'person_add', title: 'Create your free account', text: 'Name, email, password. That’s it. A one-minute tour shows you around.' },
  { icon: 'edit_calendar', title: 'Plan your day in minutes', text: 'Add tasks with a time and a length, set your routines to repeat, and add goals.' },
  { icon: 'notifications_active', title: 'Get nudged, tick it off', text: 'Turn on reminders. When a task starts you’ll know, and ticking it off fills your day’s bar.' },
];

export function Landing({ isWide, onStart }: { isWide: boolean; onStart: Start }) {
  const root = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tilt, setTilt] = useState<CSSProperties>({});
  const [busySection, setBusySection] = useState(false);
  useReveal(root);

  // On phones the floating "Get started" bar steps aside while the demo (its + button) or the final call to action is on screen.
  useEffect(() => {
    const targets = [document.getElementById('demo'), root.current?.querySelector('.lp-final')].filter(Boolean) as Element[];
    if (!targets.length || !('IntersectionObserver' in window)) return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      setBusySection(visible.size > 0);
    });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setScrolled(window.scrollY > 8);
        setProgress(max > 0 ? window.scrollY / max : 0);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      window.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // The hero phone leans gently toward the pointer on devices with a mouse.
  const lean = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ transform: `perspective(1200px) rotateY(${x * 10}deg) rotateX(${-y * 8}deg)` });
  };

  return (
    <div className="lp" ref={root}>
      <div className="lp-progress" style={{ transform: `scaleX(${progress})` }} />

      <header className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src="/logo-mark.png" alt="" width={34} height={34} />
            <span>LockedIn</span>
          </button>
          {isWide && (
            <nav className="lp-links">
              <button onClick={() => go('demo')}>Try it</button>
              <button onClick={() => go('features')}>Features</button>
              <button onClick={() => go('how')}>How it works</button>
              <button onClick={() => go('faq')}>FAQ</button>
            </nav>
          )}
          <div className="lp-nav-cta">
            <button className="lp-ghost" onClick={() => onStart('signin')}>Sign in</button>
            <button className="lp-cta small" onClick={() => onStart('signup')}>Get started</button>
          </div>
        </div>
      </header>

      <section className="lp-hero" onPointerMove={lean} onPointerLeave={() => setTilt({})}>
        <div className="lp-blob a" aria-hidden="true" />
        <div className="lp-blob b" aria-hidden="true" />
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <div className="lp-chip rise" style={{ '--d': '0ms' } as CSSProperties}><span className="ms">bolt</span>Free daily planner · works on any phone</div>
            <h1 className="lp-h1 rise" style={{ '--d': '80ms' } as CSSProperties}>
              Plan the day, the week and the month in <span className="lp-hl">one calm place.</span>
            </h1>
            <p className="lp-lead rise" style={{ '--d': '160ms' } as CSSProperties}>
              LockedIn turns your day into a simple timeline, keeps your routines on repeat, and nudges you the moment each task starts.
            </p>
            <div className="lp-hero-cta rise" style={{ '--d': '240ms' } as CSSProperties}>
              <button className="lp-cta" onClick={() => onStart('signup')}>Create your free account<span className="ms">arrow_forward</span></button>
              <button className="lp-ghost big" onClick={() => go('demo')}><span className="ms">play_circle</span>Try it first</button>
            </div>
            <ul className="lp-ticks rise" style={{ '--d': '320ms' } as CSSProperties}>
              <li><span className="ms">check_circle</span>Free forever</li>
              <li><span className="ms">check_circle</span>No app store</li>
              <li><span className="ms">check_circle</span>Syncs everywhere</li>
            </ul>
          </div>
          <div className="lp-hero-art rise" style={{ '--d': '200ms' } as CSSProperties}>
            <div className="lp-tilt" style={tilt}>
              <HeroPhone />
              <div className="lp-float f1"><span className="ms">repeat</span>Daily routine</div>
              <div className="lp-float f2"><span className="ms">schedule</span>1h 30m free</div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-strip">
        <div className="lp-wrap lp-strip-in reveal">
          <div><strong><CountUp to={3} /></strong><span>views: day, week &amp; month</span></div>
          <div><strong><CountUp to={18} /></strong><span>icons for your tasks</span></div>
          <div><strong><CountUp to={8} /></strong><span>calm colors</span></div>
          <div><strong><CountUp to={100} suffix="%" /></strong><span>free</span></div>
        </div>
      </section>

      <section className="lp-section" id="demo">
        <div className="lp-wrap">
          <div className="lp-head reveal">
            <div className="lp-eyebrow">Try it now</div>
            <h2 className="lp-h2">This is the real app. Go ahead, play with it.</h2>
            <p className="lp-sub">Tick tasks off, switch to Week or Month, tap a task to edit it, or press <strong>+</strong> to add your own. Nothing here is saved. It’s just for you to try.</p>
          </div>
          <div className="lp-demo-frame reveal">
            <LiveDemo isWide={isWide} />
          </div>
        </div>
      </section>

      <section className="lp-section alt" id="features">
        <div className="lp-wrap">
          <div className="lp-head reveal">
            <div className="lp-eyebrow">Everything you need</div>
            <h2 className="lp-h2">Small tools that keep you on track.</h2>
          </div>
          <div className="lp-grid">
            {FEATURES.map((f, i) => (
              <div className="lp-feature reveal" key={f.title} style={{ '--d': `${(i % 3) * 90}ms` } as CSSProperties}>
                <div className="lp-feature-icon"><span className="ms">{f.icon}</span></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <div className="lp-head reveal">
            <div className="lp-eyebrow">How it works</div>
            <h2 className="lp-h2">From sign-up to locked in, in three steps.</h2>
          </div>
          <div className="lp-steps reveal">
            <div className="lp-line" aria-hidden="true"><span /></div>
            {STEPS.map((s, i) => (
              <div className="lp-step" key={s.title} style={{ '--d': `${200 + i * 220}ms` } as CSSProperties}>
                <div className="lp-step-num"><span className="ms">{s.icon}</span><em>{i + 1}</em></div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section dark">
        <div className="lp-wrap lp-remind">
          <div className="lp-remind-copy reveal">
            <div className="lp-eyebrow light">Reminders</div>
            <h2 className="lp-h2">Never miss a start time again.</h2>
            <p className="lp-sub light">Turn on reminders once and LockedIn lets you know the minute each task begins, on your lock screen, even with the app closed.</p>
            <button className="lp-cta" onClick={() => onStart('signup')}>Start for free<span className="ms">arrow_forward</span></button>
          </div>
          <div className="lp-lock reveal" aria-hidden="true">
            <div className="lp-lock-time">7:14</div>
            <div className="lp-lock-date">{DOWF[new Date().getDay()]}, {MONTHS[new Date().getMonth()]} {new Date().getDate()}</div>
            {[
              ['Wake up', 'Starting now · 7:00 – 7:15 AM'],
              ['Yoga', 'Starting now · 7:15 – 7:45 AM'],
              ['Deep work', 'Starting now · 9:00 – 11:00 AM'],
            ].map(([t, b], i) => (
              <div className="lp-notif" key={t} style={{ '--d': `${300 + i * 450}ms` } as CSSProperties}>
                <img src="/icon-192.png" alt="" />
                <div><strong>{t}</strong><span>{b}</span></div>
                <em>{i === 0 ? '14m ago' : i === 1 ? 'now' : ''}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq-wrap">
          <div className="lp-head reveal">
            <div className="lp-eyebrow">Questions</div>
            <h2 className="lp-h2">Good to know.</h2>
          </div>
          <div className="lp-faq reveal">
            {FAQ.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>{f.q}<span className="ms">expand_more</span></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap lp-final-in reveal">
          <img src="/logo-mark.png" alt="" width={64} height={64} />
          <h2 className="lp-h2">Ready to get locked in?</h2>
          <p className="lp-sub light">Your first plan takes about two minutes.</p>
          <div className="lp-hero-cta center">
            <button className="lp-cta" onClick={() => onStart('signup')}>Create your free account<span className="ms">arrow_forward</span></button>
            <button className="lp-ghost big light" onClick={() => onStart('signin')}>I already have an account</button>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-brand static"><img src="/logo-mark.png" alt="" width={26} height={26} /><span>LockedIn</span></div>
          <span>© {new Date().getFullYear()} LockedIn · Plan the day, the week and the month.</span>
          <button className="lp-ghost" onClick={() => onStart('signin')}>Sign in</button>
        </div>
      </footer>

      {!isWide && (
        <div className={`lp-sticky${scrolled && !busySection ? ' show' : ''}`} aria-hidden={!scrolled || busySection}>
          <button className="lp-cta" onClick={() => onStart('signup')}>Get started free<span className="ms">arrow_forward</span></button>
        </div>
      )}
    </div>
  );
}
