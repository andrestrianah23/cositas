import { addDays, occurs, parse, weekStart, ymd } from './dates';
import type { Task } from './types';

/** How far back streaks and rates look. */
const LOOKBACK_DAYS = 400;

/** A habit is a timed task that repeats; only habits get streaks. */
export const isHabit = (t: Task) => t.kind === 'timed' && !!t.repeat && t.repeat !== 'none';

/** "day", "week" or "month": what one step of a habit's streak is. */
export const streakUnit = (t: Task) => (t.repeat === 'weekly' ? 'week' : t.repeat === 'monthly' ? 'month' : 'day');

/**
 * Occurrences ticked in a row, counting back from today.
 * Today's occurrence only adds to the streak once it's ticked; still being open doesn't break it.
 */
export function currentStreak(t: Task, today: string) {
  if (!isHabit(t)) return 0;
  let n = 0;
  let d = parse(today);
  for (let i = 0; i < LOOKBACK_DAYS; i++, d = addDays(d, -1)) {
    const ds = ymd(d);
    if (ds < t.date) break;
    if (!occurs(t, ds)) continue;
    if (t.done[ds]) n++;
    else if (ds !== today) break;
  }
  return n;
}

/** The longest run of ticked occurrences in the lookback window. */
export function bestStreak(t: Task, today: string) {
  if (!isHabit(t)) return 0;
  let best = 0, run = 0;
  const startDay = parse(today);
  for (let i = LOOKBACK_DAYS; i >= 0; i--) {
    const ds = ymd(addDays(startDay, -i));
    if (ds < t.date || !occurs(t, ds)) continue;
    if (t.done[ds]) best = Math.max(best, ++run);
    else if (ds !== today) run = 0;
  }
  return best;
}

/** The habit with the longest streak going right now. */
export function topStreak(tasks: Task[], today: string) {
  let top: { task: Task; streak: number } | null = null;
  for (const t of tasks) {
    const s = currentStreak(t, today);
    if (s > 0 && (!top || s > top.streak)) top = { task: t, streak: s };
  }
  return top;
}

export interface Tally {
  planned: number;
  done: number;
}

/** Timed tasks planned and ticked on one day. */
export function dayTally(tasks: Task[], ds: string): Tally {
  const due = tasks.filter((t) => t.kind === 'timed' && occurs(t, ds));
  return { planned: due.length, done: due.filter((t) => t.done[ds]).length };
}

/** Sum of daily tallies from `from` to `to` (inclusive, YYYY-MM-DD). */
export function rangeTally(tasks: Task[], from: string, to: string): Tally {
  const out = { planned: 0, done: 0 };
  for (let d = parse(from); ymd(d) <= to; d = addDays(d, 1)) {
    const t = dayTally(tasks, ymd(d));
    out.planned += t.planned;
    out.done += t.done;
  }
  return out;
}

/** The week containing `ds` (Monday to Sunday), counted up to today so the future doesn't drag it down. */
export function weekTally(tasks: Task[], ds: string, today: string): Tally {
  const ws = weekStart(parse(ds)), we = ymd(addDays(ws, 6));
  if (ymd(ws) > today) return { planned: 0, done: 0 };
  return rangeTally(tasks, ymd(ws), we < today ? we : today);
}

export const pct = (t: Tally) => (t.planned ? Math.round((t.done / t.planned) * 100) : null);

/** The last `n` occurrences of a task up to today, oldest first. */
export function recentOccurrences(t: Task, today: string, n: number) {
  const out: { ds: string; done: boolean }[] = [];
  let d = parse(today);
  for (let i = 0; i < LOOKBACK_DAYS && out.length < n; i++, d = addDays(d, -1)) {
    const ds = ymd(d);
    if (ds < t.date) break;
    if (occurs(t, ds)) out.push({ ds, done: !!t.done[ds] });
  }
  return out.reverse();
}

/** Share of a task's occurrences in the last `days` days that were ticked. Today counts only once ticked. */
export function taskRate(t: Task, today: string, days = 30): Tally {
  const out = { planned: 0, done: 0 };
  let d = parse(today);
  for (let i = 0; i < days; i++, d = addDays(d, -1)) {
    const ds = ymd(d);
    if (ds < t.date) break;
    if (!occurs(t, ds)) continue;
    if (t.done[ds]) out.done++;
    if (t.done[ds] || ds !== today) out.planned++;
  }
  return out;
}
