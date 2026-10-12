import webpush from 'web-push';
import type { Router } from 'express';
import { requireUser } from './auth';
import { TASK_COLS, type Db } from './db';
import { fmtD, fmtT, isYmd, occurs, parse, toMin, weekStart, ymd } from '../shared/dates';
import { goalInPeriod, goalProgress } from '../shared/goals';
import { pct, streakUnit, topStreak, weekTally } from '../shared/stats';
import { DEFAULT_PREFS, MORNING_LEAD_MIN, type NotifyPrefs, type Task } from '../shared/types';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Task reminders: lets the notification's Done / Remind-me buttons act on the right occurrence. */
  taskId?: string;
  day?: string;
  actions?: { action: string; title: string }[];
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidPublicKey = '';

/**
 * Loads the VAPID keys that sign push messages. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY win when set;
 * otherwise a pair is generated once and kept in the database, so no configuration is needed.
 */
export async function initPush(db: Db, env = process.env) {
  let pub = env.VAPID_PUBLIC_KEY, priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const fresh = webpush.generateVAPIDKeys();
    await db.query(
      `INSERT INTO app_settings (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO NOTHING`,
      [fresh.publicKey, fresh.privateKey],
    );
    const { rows } = await db.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key LIKE 'vapid_%'`);
    pub = rows.find((r) => r.key === 'vapid_public')!.value;
    priv = rows.find((r) => r.key === 'vapid_private')!.value;
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT || `mailto:${env.ADMIN_EMAIL || 'admin@lockedin.app'}`, pub, priv);
  vapidPublicKey = pub;
}

/** Sends to every device the user enabled reminders on. Returns how many deliveries succeeded. */
export async function sendToUser(db: Db, userId: string, payload: PushPayload) {
  const { rows } = await db.query<SubRow>('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  let sent = 0;
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 30 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // The browser dropped this subscription (uninstalled, permission revoked).
        if (code === 404 || code === 410) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
        else console.error('push failed', code ?? e);
      }
    }),
  );
  return sent;
}

const isTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Wall-clock date (YYYY-MM-DD) and minute of the day in a time zone. */
export function localNow(tz: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { ds: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

// A tick can run late; anything due in the last few minutes still goes out once.
const CATCH_UP_MIN = 3;
/** The evening check-in goes out this long after the day's last task ends... */
export const CHECKIN_AFTER_MIN = 120;
/** ...and is skipped if the server only gets to it more than this much later. */
const CHECKIN_WINDOW_MIN = 180;
/** "Remind me again" from a notification. */
export const SNOOZE_MIN = 10;
const TASK_ACTIONS = [{ action: 'done', title: 'Done ✓' }, { action: 'snooze', title: `Remind me in ${SNOOZE_MIN} min` }];

const shiftDay = (ds: string, n: number) => {
  const [y, m, d] = ds.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
};

/** "Gym", "Gym and Read", "Gym, Read and Journal", "Gym, Read, Journal and 2 more". */
function listTitles(titles: string[]) {
  if (titles.length === 1) return titles[0];
  const shown = titles.slice(0, 3), rest = titles.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Claims a once-per-period notification; false when it already went out. */
async function claim(db: Db, userId: string, kind: string, period: string) {
  const { rowCount } = await db.query('INSERT INTO notify_log (user_id, kind, period) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, kind, period]);
  return !!rowCount;
}

/** A task reminder with Done / Remind-me buttons. `lead` = minutes until it starts. */
function taskPayload(t: Task, day: string, lead: number, snoozed = false): PushPayload {
  const start = toMin(t.start!);
  const range = `${fmtT(start)} – ${fmtT(start + t.dur!)}`;
  const when = snoozed ? (lead > 0 ? `Starts in ${fmtD(lead)}` : 'Reminder') : lead > 0 ? `Starts in ${fmtD(lead)}` : 'Starting now';
  return { title: t.title, body: `${when} · ${range}`, url: `/?day=${day}`, tag: `task-${t.id}`, taskId: t.id, day, actions: TASK_ACTIONS };
}

/**
 * One gentle nudge a day: two hours after the day's last task ends, if anything is still unticked.
 * Looks at today and yesterday, since a late last task puts the check-in after midnight.
 */
async function sendCheckIn(db: Db, userId: string, tasks: Task[], ds: string, min: number, send: typeof sendToUser) {
  for (const [day, rel] of [[ds, min], [shiftDay(ds, -1), min + 1440]] as const) {
    const due = tasks.filter((t) => occurs(t, day));
    if (!due.length) continue;
    const lastEnd = Math.max(...due.map((t) => toMin(t.start!) + t.dur!));
    const at = lastEnd + CHECKIN_AFTER_MIN;
    if (rel < at || rel > at + CHECKIN_WINDOW_MIN) continue;
    const open = due.filter((t) => !t.done?.[day]).sort((a, b) => toMin(a.start!) - toMin(b.start!));
    if (!open.length || !(await claim(db, userId, 'checkin', day))) continue;
    await send(db, userId, {
      title: open.length === 1 ? 'Quick check-in: 1 task to tick' : `Quick check-in: ${open.length} tasks to tick`,
      body: `Did you get to ${listTitles(open.map((t) => t.title))}? Tick off what you did so your day counts.`,
      url: `/?day=${day}`,
      tag: `checkin-${day}`,
    });
  }
}

/** Morning briefing: the shape of the day, sent before the first task (or at the time they chose). */
async function sendMorning(db: Db, userId: string, name: string, prefs: NotifyPrefs, tasks: Task[], ds: string, min: number, send: typeof sendToUser) {
  if (prefs.morning === 'off') return;
  const due = tasks.filter((t) => occurs(t, ds)).sort((a, b) => toMin(a.start!) - toMin(b.start!));
  if (!due.length) return;
  const at = prefs.morning === 'auto' ? Math.max(0, toMin(due[0].start!) - MORNING_LEAD_MIN) : toMin(prefs.morning);
  if (min < at || min > at + CATCH_UP_MIN || !(await claim(db, userId, 'morning', ds))) return;
  const next = due.find((t) => toMin(t.start!) >= min) ?? null;
  const streak = topStreak(due, ds);
  const parts = [`${plural(due.length, 'task')} today.`];
  if (next) parts.push(`First up: ${next.title} at ${fmtT(toMin(next.start!))}.`);
  if (streak && streak.streak >= 3) parts.push(`Keep your ${streak.streak}-${streakUnit(streak.task)} ${streak.task.title} streak going.`);
  await send(db, userId, { title: `Good morning, ${firstName(name)}`, body: parts.join(' '), url: `/?day=${ds}`, tag: `morning-${ds}` });
}

/** Sunday weekly review: what got done, goals hit, best streak. */
async function sendReview(db: Db, userId: string, name: string, prefs: NotifyPrefs, tasks: Task[], ds: string, min: number, send: typeof sendToUser) {
  if (prefs.review === 'off' || parse(ds).getDay() !== 0) return;
  const at = toMin(prefs.review);
  if (min < at || min > at + CATCH_UP_MIN) return;
  const week = weekTally(tasks, ds, ds);
  if (!week.planned) return;
  const ws = ymd(weekStart(parse(ds)));
  if (!(await claim(db, userId, 'review', ws))) return;
  const goals = tasks.filter((t) => t.kind === 'week' && goalInPeriod(t, ws));
  const hit = goals.filter((g) => goalProgress(g, ws, tasks).done).length;
  const rate = pct(week)!;
  const streak = topStreak(tasks, ds);
  const parts = [`You finished ${week.done} of ${plural(week.planned, 'task')} this week (${rate}%).`];
  if (goals.length) parts.push(`Weekly goals hit: ${hit} of ${goals.length}.`);
  if (streak && streak.streak >= 2) parts.push(`Best streak: ${streak.task.title}, ${plural(streak.streak, streakUnit(streak.task))} in a row.`);
  parts.push('Tap to see your progress and plan next week.');
  const title = rate >= 80 ? `Great week, ${firstName(name)}!` : rate >= 50 ? 'Your week in review' : 'New week, fresh start';
  await send(db, userId, { title, body: parts.join(' '), url: '/?view=progress', tag: `review-${ws}` });
}

/** Runs every minute: task reminders, snoozes, the evening check-in, the morning briefing and the Sunday review. */
export async function sendDueReminders(db: Db, now = new Date(), send: typeof sendToUser = sendToUser) {
  const { rows: people } = await db.query<{ user_id: string; tz: string; name: string; notify_prefs: Partial<NotifyPrefs> }>(
    `SELECT DISTINCT ON (s.user_id) s.user_id, s.tz, u.name, u.notify_prefs FROM push_subscriptions s
     JOIN users u ON u.id = s.user_id AND u.status = 'active' ORDER BY s.user_id, s.created_at DESC`,
  );
  for (const { user_id, tz, name, notify_prefs } of people) {
    const prefs: NotifyPrefs = { ...DEFAULT_PREFS, ...notify_prefs };
    const { ds, min } = localNow(tz, now);
    const tomorrow = shiftDay(ds, 1);
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 AND date <= $2`, [user_id, tomorrow]);
    const all = rows.map((t) => ({ ...t, done: t.done ?? {}, links: t.links ?? [] }));
    const timed = all.filter((t) => t.kind === 'timed');

    if (prefs.tasks) {
      for (const t of timed) {
        if (t.remind === -1) continue;
        // A reminder before an early task can fall on the evening before.
        for (const [day, base] of [[ds, 0], [tomorrow, 1440]] as const) {
          if (!occurs(t, day) || t.done[day]) continue;
          const startAt = base + toMin(t.start!), fire = startAt - (t.remind ?? 0);
          if (fire > min || fire < min - CATCH_UP_MIN) continue;
          const { rowCount } = await db.query('INSERT INTO push_log (task_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, day]);
          if (rowCount) await send(db, user_id, taskPayload(t, day, startAt - min));
        }
      }
    }

    const { rows: snoozes } = await db.query<{ task_id: string; day: string }>(
      'DELETE FROM push_snooze WHERE user_id = $1 AND due_at <= $2 RETURNING task_id, day',
      [user_id, now],
    );
    for (const z of snoozes) {
      const t = timed.find((x) => x.id === z.task_id);
      if (t && !t.done[z.day]) {
        const startAt = (z.day === ds ? 0 : z.day === tomorrow ? 1440 : -1440) + toMin(t.start!);
        await send(db, user_id, taskPayload(t, z.day, startAt - min, true));
      }
    }

    if (prefs.checkin) await sendCheckIn(db, user_id, timed, ds, min, send);
    await sendMorning(db, user_id, name, prefs, timed, ds, min, send);
    await sendReview(db, user_id, name, prefs, all, ds, min, send);
  }
  await db.query(`DELETE FROM push_log WHERE sent_at < now() - interval '3 days'`);
  await db.query(`DELETE FROM notify_log WHERE sent_at < now() - interval '30 days'`);
  await db.query(`DELETE FROM push_snooze WHERE due_at < now() - interval '1 day'`);
}

export function startReminderLoop(db: Db) {
  const tick = () => sendDueReminders(db).catch((e) => console.error('reminders failed', e));
  // Run on every minute boundary (+2s), so reminders land right when a task starts.
  const schedule = () => setTimeout(() => (tick(), schedule()), 60_000 - (Date.now() % 60_000) + 2_000);
  tick();
  schedule();
}

export function pushRoutes(api: Router, db: Db) {
  api.get('/push/key', (_req, res) => {
    res.json({ publicKey: vapidPublicKey });
  });

  api.post('/push/subscribe', requireUser, async (req, res) => {
    const sub = req.body?.subscription;
    const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
    const tz = req.body?.tz;
    const valid =
      typeof endpoint === 'string' && endpoint.startsWith('https://') && endpoint.length < 1000 &&
      typeof p256dh === 'string' && p256dh.length < 200 && typeof auth === 'string' && auth.length < 100;
    if (!valid) return res.status(400).json({ error: 'Invalid subscription' });
    if (!isTimeZone(tz)) return res.status(400).json({ error: 'Invalid time zone' });
    // A device belongs to whoever enabled reminders on it most recently.
    await db.query(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, tz) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $3, auth = $4, tz = $5, created_at = now()`,
      [endpoint, req.user!.id, p256dh, auth, tz],
    );
    res.json({ ok: true });
  });

  api.post('/push/unsubscribe', requireUser, async (req, res) => {
    if (typeof req.body?.endpoint === 'string') {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [req.body.endpoint, req.user!.id]);
    }
    res.json({ ok: true });
  });

  api.post('/push/snooze', requireUser, async (req, res) => {
    const { taskId, day } = req.body ?? {};
    if (typeof taskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(taskId) || !isYmd(day)) return res.status(400).json({ error: 'Invalid snooze' });
    const { rowCount } = await db.query(
      `INSERT INTO push_snooze (task_id, day, user_id, due_at)
       SELECT id, $2, user_id, now() + make_interval(mins => $4) FROM tasks WHERE id = $1 AND user_id = $3 AND kind = 'timed'
       ON CONFLICT (task_id, day) DO UPDATE SET due_at = EXCLUDED.due_at`,
      [taskId, day, req.user!.id, SNOOZE_MIN],
    );
    if (!rowCount) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, minutes: SNOOZE_MIN });
  });

  api.post('/push/test', requireUser, async (req, res) => {
    const sent = await sendToUser(db, req.user!.id, { title: 'Reminders are on', body: 'LockedIn will nudge you when each task starts.', url: '/', tag: 'test' });
    if (!sent) return res.status(400).json({ error: 'No device with reminders turned on.' });
    res.json({ sent });
  });
}
