import { addDays, keyFor, occurs, parse, weekStart, ymd } from './dates';
import type { Task } from './types';

/** A goal shows up in its own week/month, and in every later one if it repeats. */
export function goalInPeriod(g: Task, key: string) {
  const own = keyFor(g, g.date);
  const recurring = g.kind === 'week' ? g.repeat === 'weekly' : g.repeat === 'monthly';
  return recurring ? key >= own : key === own;
}

/** Every day (YYYY-MM-DD) in a week (key = its Monday) or a month (key = YYYY-MM). */
export function periodDays(kind: 'week' | 'month', key: string) {
  if (kind === 'week') {
    const ws = parse(key);
    return [...Array(7)].map((_, i) => ymd(addDays(ws, i)));
  }
  const [y, m] = key.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return [...Array(n)].map((_, i) => ymd(new Date(y, m - 1, i + 1)));
}

/** Mondays of the weeks that start in a month: the weeks a monthly goal counts. */
export function weeksOfMonth(key: string) {
  return periodDays('month', key).filter((d) => parse(d).getDay() === 1);
}

export interface GoalProgress {
  /** Ticks counted from linked tasks, or null when the goal isn't linked. */
  count: number | null;
  target: number | null;
  /** Reached the target through linked tasks. */
  auto: boolean;
  done: boolean;
}

export function goalProgress(g: Task, key: string, tasks: Task[], depth = 0): GoalProgress {
  const manual = !!g.done[key];
  if (!g.target || !g.links?.length || depth > 1) return { count: null, target: null, auto: false, done: manual };
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kind = g.kind === 'week' ? 'week' : 'month';
  let count = 0;
  for (const id of g.links) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.kind === 'timed') {
      for (const d of periodDays(kind, key)) if (occurs(t, d) && t.done[d]) count++;
    } else if (t.kind === 'week' && kind === 'month') {
      for (const ws of weeksOfMonth(key)) if (goalInPeriod(t, ws) && goalProgress(t, ws, tasks, depth + 1).done) count++;
    }
  }
  const auto = count >= g.target;
  return { count, target: g.target, auto, done: manual || auto };
}

/** The period key a goal kind uses for the selected day. */
export const goalKey = (kind: 'week' | 'month', sel: string) => (kind === 'week' ? ymd(weekStart(parse(sel))) : sel.slice(0, 7));
