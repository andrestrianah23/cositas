import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, fmtT, MONTHS, parse, toMin, weekStart, ymd } from '../../shared/dates';
import { goalInPeriod, goalKey, goalProgress } from '../../shared/goals';
import { bestStreak, currentStreak, isHabit, pct, rangeTally, recentOccurrences, streakUnit, taskRate, topStreak, weekTally, type Tally } from '../../shared/stats';
import type { Task } from '../../shared/types';
import { colorOf } from '../theme';
import { Goals } from './Goals';

const WEEKS = 8;
const short = (ds: string) => {
  const d = parse(ds);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

/** Completion % per week for the last 8 weeks: one series, so no legend; hover or tap a bar for its numbers. */
function WeeksChart({ weeks }: { weeks: { ws: string; tally: Tally; rate: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the real width so text stays at its real size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 190, padL = 38, padB = 26, padT = 20, plotH = H - padB - padT;
  const slot = (W - padL) / weeks.length, bar = Math.min(24, slot * 0.5);
  const y = (v: number) => padT + plotH * (1 - v / 100);
  const shown = hover ?? weeks.length - 1;
  const cur = weeks[shown];
  return (
    <div className="chart" ref={box}>
      <div className="chart-readout" aria-live="polite">
        <strong>{cur.rate === null ? 'No tasks' : `${cur.rate}%`}</strong>
        <span>{shown === weeks.length - 1 ? 'This week' : `Week of ${short(cur.ws)}`}{cur.tally.planned ? ` · ${cur.tally.done} of ${cur.tally.planned} tasks` : ''}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly completion, last ${WEEKS} weeks: ${weeks.map((w) => `week of ${short(w.ws)} ${w.rate === null ? 'no tasks' : `${w.rate}%`}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={padL - 8} y={y(v) + 4} className="chart-tick" textAnchor="end">{v}%</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = w.rate === null ? 0 : Math.max(2, (plotH * w.rate) / 100);
          const top = padT + plotH - h, r = Math.min(4, h);
          const on = i === shown;
          return (
            <g key={w.ws}>
              {h > 0 && (
                <path
                  className={`chart-bar${on ? ' on' : ''}${i === weeks.length - 1 ? ' now' : ''}`}
                  d={`M${cx - bar / 2},${padT + plotH} V${top + r} Q${cx - bar / 2},${top} ${cx - bar / 2 + r},${top} H${cx + bar / 2 - r} Q${cx + bar / 2},${top} ${cx + bar / 2},${top + r} V${padT + plotH} Z`}
                />
              )}
              {on && w.rate !== null && <text x={cx} y={top - 6} className="chart-value" textAnchor="middle">{w.rate}%</text>}
              {(slot >= 46 || i % 2 === weeks.length % 2 || on) && (
                <text x={cx} y={H - 8} className={`chart-tick${on ? ' strong' : ''}`} textAnchor="middle">{i === weeks.length - 1 ? 'Now' : short(w.ws)}</text>
              )}
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect
                x={cx - slot / 2} y={padT} width={slot} height={plotH + padB} fill="transparent" tabIndex={0}
                aria-label={`Week of ${short(w.ws)}: ${w.rate === null ? 'no tasks' : `${w.tally.done} of ${w.tally.planned} tasks, ${w.rate}%`}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ProgressView({ tasks, today }: { tasks: Task[]; today: string }) {
  const habits = useMemo(() => tasks.filter(isHabit).sort((a, b) => toMin(a.start!) - toMin(b.start!)), [tasks]);
  const weeks = useMemo(() => {
    const ws = weekStart(parse(today));
    return [...Array(WEEKS)].map((_, k) => {
      const d = ymd(addDays(ws, -7 * (WEEKS - 1 - k)));
      const tally = weekTally(tasks, d, today);
      return { ws: d, tally, rate: pct(tally) };
    });
  }, [tasks, today]);

  const now = weeks[WEEKS - 1], prev = weeks[WEEKS - 2];
  const top = topStreak(tasks, today);
  const weekK = goalKey('week', today), monthK = goalKey('month', today);
  const weekGoals = tasks.filter((t) => t.kind === 'week' && goalInPeriod(t, weekK));
  const monthGoals = tasks.filter((t) => t.kind === 'month' && goalInPeriod(t, monthK));
  const hit = weekGoals.filter((g) => goalProgress(g, weekK, tasks).done).length;

  // Compare with the same point last week, not the whole of it: Monday morning shouldn't look like falling behind.
  const elapsed = Math.round((parse(today).getTime() - parse(now.ws).getTime()) / 864e5);
  const prevSoFar = pct(rangeTally(tasks, prev.ws, ymd(addDays(parse(prev.ws), elapsed))));
  let cheer = 'Every tick counts. Start with one task today.';
  if (now.rate !== null && prevSoFar !== null) {
    const diff = now.rate - prevSoFar;
    cheer = diff > 0 ? `${diff} points ahead of this time last week. Keep it up!` : diff === 0 ? 'Right on pace with last week.' : `${-diff} points behind this time last week. There’s still time to catch up.`;
  } else if (now.rate !== null) cheer = now.rate >= 80 ? 'Strong week so far!' : 'Keep going. Small steps add up.';

  return (
    <div className="progress-view">
      <div className="stats">
        <div className="stat"><div className="stat-label">This week</div><div className="stat-value">{now.rate === null ? '–' : `${now.rate}%`}</div><div className="stat-sub">{now.tally.done} of {now.tally.planned} tasks done</div></div>
        <div className="stat"><div className="stat-label">Longest streak now</div><div className="stat-value">{top ? <><span className="ms flame">local_fire_department</span>{top.streak}</> : '0'}</div><div className="stat-sub">{top ? `${top.task.title} · ${streakUnit(top.task)}s` : 'Tick a habit twice in a row'}</div></div>
        <div className="stat"><div className="stat-label">Weekly goals</div><div className="stat-value">{weekGoals.length ? `${hit}/${weekGoals.length}` : '–'}</div><div className="stat-sub">{weekGoals.length ? 'hit this week' : 'No goals this week'}</div></div>
        <div className="stat"><div className="stat-label">Last week</div><div className="stat-value">{prev.rate === null ? '–' : `${prev.rate}%`}</div><div className="stat-sub">{prev.tally.done} of {prev.tally.planned} tasks done</div></div>
      </div>

      <div className="card progress-card">
        <div className="goals-head"><div className="card-title">Last {WEEKS} weeks</div><div className="goals-count">Tasks done</div></div>
        <div className="cheer"><span className="ms">trending_up</span>{cheer}</div>
        <WeeksChart weeks={weeks} />
      </div>

      <div className="card progress-card">
        <div className="goals-head"><div className="card-title">Habits</div><div className="goals-count">Last 14 times · 30-day rate</div></div>
        {!habits.length && <div className="empty"><strong>No habits yet</strong>Set a task to repeat daily, weekly or monthly and its streak shows up here.</div>}
        {habits.map((t) => {
          const cur = currentStreak(t, today), best = bestStreak(t, today), rate = taskRate(t, today), occ = recentOccurrences(t, today, 14);
          const r = pct(rate);
          return (
            <div className="habit" key={t.id}>
              <span className="link-tile" style={{ background: colorOf(t.color) }}><span className="ms">{t.icon}</span></span>
              <div className="habit-main">
                <div className="habit-top">
                  <strong>{t.title}</strong>
                  <span className="habit-time">{fmtT(toMin(t.start!))}</span>
                  {cur >= 2 && <span className="streak-chip"><span className="ms">local_fire_department</span>{cur} {streakUnit(t)}s</span>}
                </div>
                <div className="habit-dots" aria-label={`Last ${occ.length}: ${occ.filter((o) => o.done).length} done`}>
                  {occ.map((o) => <span key={o.ds} title={`${short(o.ds)}: ${o.done ? 'done' : o.ds === today ? 'not yet' : 'missed'}`} className={o.done ? 'done' : o.ds === today ? 'today' : ''} style={o.done ? { background: colorOf(t.color) } : undefined} />)}
                </div>
                <div className="habit-sub">{best ? `Best streak ${best} ${streakUnit(t)}${best === 1 ? '' : 's'}` : 'No streak yet'}</div>
              </div>
              <div className="habit-rate"><strong>{r === null ? '–' : `${r}%`}</strong><span>30 days</span></div>
            </div>
          );
        })}
      </div>

      <div className="customer-goals">
        <Goals title="This week’s goals" placeholder="" goals={weekGoals} periodKey={weekK} tasks={tasks} />
        <Goals title="This month’s goals" placeholder="" goals={monthGoals} periodKey={monthK} tasks={tasks} />
      </div>
    </div>
  );
}
