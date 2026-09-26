import webpush from 'web-push';
import type { Router } from 'express';
import { requireUser } from './auth';
import { TASK_COLS, type Db } from './db';
import { fmtT, occurs, toMin } from '../shared/dates';
import type { Task } from '../shared/types';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
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

// A tick can run late; anything that started in the last few minutes still gets its reminder once.
const CATCH_UP_MIN = 3;

/** Sends "task starting" reminders for every subscribed user whose task starts now in their time zone. */
export async function sendDueReminders(db: Db, now = new Date(), send: typeof sendToUser = sendToUser) {
  const { rows: people } = await db.query<{ user_id: string; tz: string }>(
    `SELECT DISTINCT ON (s.user_id) s.user_id, s.tz FROM push_subscriptions s
     JOIN users u ON u.id = s.user_id AND u.status = 'active' ORDER BY s.user_id, s.created_at DESC`,
  );
  for (const { user_id, tz } of people) {
    const { ds, min } = localNow(tz, now);
    const { rows: tasks } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 AND kind = 'timed' AND date <= $2`, [user_id, ds]);
    for (const t of tasks) {
      const start = toMin(t.start!);
      if (start > min || start < min - CATCH_UP_MIN || !occurs(t, ds) || t.done?.[ds]) continue;
      const { rowCount } = await db.query('INSERT INTO push_log (task_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, ds]);
      if (!rowCount) continue;
      await send(db, user_id, { title: t.title, body: `Starting now · ${fmtT(start)} – ${fmtT(start + t.dur!)}`, url: '/', tag: `task-${t.id}` });
    }
  }
  await db.query(`DELETE FROM push_log WHERE sent_at < now() - interval '3 days'`);
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

  api.post('/push/test', requireUser, async (req, res) => {
    const sent = await sendToUser(db, req.user!.id, { title: 'Reminders are on', body: 'Lockedin will nudge you when each task starts.', url: '/', tag: 'test' });
    if (!sent) return res.status(400).json({ error: 'No device with reminders turned on.' });
    res.json({ sent });
  });
}
