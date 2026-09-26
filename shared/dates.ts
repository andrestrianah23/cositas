import type { Task } from './types';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DOWF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => {
  const [a, b, c] = s.split('-').map(Number);
  return new Date(a, b - 1, c);
};
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
/** Monday of the week containing d. */
export const weekStart = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
export const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
export const fmtT = (m: number) => {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
};
export const fmtD = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`);

export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
export const isHm = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Whether a timed task happens on day ds, following its repeat rule. */
export function occurs(t: Task, ds: string) {
  if (t.kind !== 'timed' || ds < t.date) return false;
  if (t.repeat === 'daily') return true;
  if (t.repeat === 'weekly') return parse(t.date).getDay() === parse(ds).getDay();
  if (t.repeat === 'monthly') return parse(t.date).getDate() === parse(ds).getDate();
  return t.date === ds;
}

/** The key under which completion is stored in task.done for the occurrence on ds. */
export const keyFor = (t: Pick<Task, 'kind'>, ds: string) =>
  t.kind === 'week' ? ymd(weekStart(parse(ds))) : t.kind === 'month' ? ds.slice(0, 7) : ds;

/** Valid completion keys: a day, or a month for monthly goals. */
export const isDoneKey = (s: unknown): s is string => isYmd(s) || (typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s));
