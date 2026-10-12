import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { endSession, hashPassword, loadUser, requireAdmin, requireUser, startSession, verifyPassword } from './auth';
import { TASK_COLS, toTask, toUser, type Db, type UserRow } from './db';
import { pushRoutes, sendToUser } from './push';
import { isDoneKey, isHm, isYmd, toMin } from '../shared/dates';
import { currentStreak } from '../shared/stats';
import { COLOR_COUNT, DEFAULT_PREFS, ICONS, MAX_DUR, MAX_LINKS, MAX_TARGET, REMIND_OPTIONS, REPEATS, type AdminStats, type GoalInput, type NotifyPrefs, type AdminUser, type NotifyResult, type Task, type TimedTaskInput } from '../shared/types';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string) => new HttpError(400, msg);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function timedInput(b: Record<string, unknown>, partial: boolean): Partial<TimedTaskInput> {
  const out: Partial<TimedTaskInput> = {};
  const has = (k: string) => !partial || k in b;
  if (has('title')) {
    out.title = str(b.title, 200);
    if (!out.title) throw bad('Give your task a name');
  }
  if (has('date')) {
    if (!isYmd(b.date)) throw bad('Invalid date');
    out.date = b.date;
  }
  if (has('start')) {
    if (!isHm(b.start)) throw bad('Invalid start time');
    out.start = b.start;
  }
  if (has('dur')) {
    if (!Number.isInteger(b.dur) || (b.dur as number) < 1 || (b.dur as number) > MAX_DUR) throw bad('End time must be after the start time');
    out.dur = b.dur as number;
  }
  if (has('color')) {
    if (!Number.isInteger(b.color) || (b.color as number) < 0 || (b.color as number) >= COLOR_COUNT) throw bad('Invalid color');
    out.color = b.color as number;
  }
  if (has('icon')) {
    if (!ICONS.includes(b.icon as string)) throw bad('Invalid icon');
    out.icon = b.icon as string;
  }
  if (has('repeat')) {
    if (!REPEATS.includes(b.repeat as TimedTaskInput['repeat'])) throw bad('Invalid repeat');
    out.repeat = b.repeat as TimedTaskInput['repeat'];
  }
  if (has('remind')) {
    const r = b.remind ?? 0;
    if (!REMIND_OPTIONS.includes(r as number)) throw bad('Invalid reminder');
    out.remind = r as number;
  }
  return out;
}

/** A task ends by midnight; anything longer is split into a task for the next day. */
function sameDay(start: string, dur: number) {
  if (toMin(start) + dur > 1440) throw bad('A task has to end by midnight. For something that runs later, add a second task for the next day.');
}

function goalInput(kind: 'week' | 'month', b: Record<string, unknown>, partial: boolean): Partial<GoalInput> {
  const out: Partial<GoalInput> = {};
  const has = (k: string) => !partial || k in b;
  if (has('title')) {
    out.title = str(b.title, 200);
    if (!out.title) throw bad('Goal cannot be empty');
  }
  if (has('repeat')) {
    const r = b.repeat ?? 'none';
    if (r !== 'none' && r !== (kind === 'week' ? 'weekly' : 'monthly')) throw bad('Invalid repeat');
    out.repeat = r as GoalInput['repeat'];
  }
  if (has('target')) {
    const t = b.target ?? null;
    if (t !== null && (!Number.isInteger(t) || (t as number) < 1 || (t as number) > MAX_TARGET)) throw bad(`Target must be between 1 and ${MAX_TARGET}`);
    out.target = t as number | null;
  }
  if (has('links')) {
    const l = b.links ?? [];
    if (!Array.isArray(l) || l.length > MAX_LINKS || !l.every((x) => typeof x === 'string' && UUID_RE.test(x))) throw bad('Invalid links');
    out.links = [...new Set(l as string[])];
  }
  return out;
}

export function createApp(db: Db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
        },
      },
    }),
  );

  const api = express.Router();
  api.use(express.json({ limit: '20kb' }));
  // JSON-only API: requiring the JSON content type forces a CORS preflight on cross-site writes.
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' });
    }
    next();
  });
  api.use(loadUser(db));

  api.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  api.get('/config', (_req, res) => {
    res.json({ demo: process.env.SEED_DEMO === 'true' });
  });

  // ---------- Auth ----------
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT) || 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });

  api.post('/auth/signup', authLimiter, async (req, res) => {
    const name = str(req.body?.name, 80);
    const email = str(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name) throw bad('Please enter your name.');
    if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email.');
    if (password.length < 6) throw bad('Password must be at least 6 characters.');
    if (password.length > 72) throw bad('Password must be at most 72 characters.');
    const hash = await hashPassword(password);
    const { rows } = await db.query<UserRow>(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING *',
      [name, email, hash],
    );
    if (!rows[0]) throw bad('An account with this email already exists.');
    await startSession(db, req, res, rows[0].id);
    res.status(201).json({ user: toUser(rows[0]) });
  });

  api.post('/auth/signin', authLimiter, async (req, res) => {
    const email = str(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const u = rows[0];
    const ok = await verifyPassword(password, u?.password_hash);
    if (!u || !ok) throw bad('Email or password is incorrect.');
    if (u.status !== 'active') throw new HttpError(403, 'This account has been suspended by an administrator.');
    await startSession(db, req, res, u.id);
    res.json({ user: toUser(u) });
  });

  api.post('/auth/signout', async (req, res) => {
    await endSession(db, req, res);
    res.json({ ok: true });
  });

  // ---------- Me ----------
  api.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  api.patch('/me', requireUser, async (req, res) => {
    const name = str(req.body?.name, 80);
    if (!name) throw bad('Please enter your name.');
    const { rows } = await db.query<UserRow>('UPDATE users SET name = $1 WHERE id = $2 RETURNING *', [name, req.user!.id]);
    res.json({ user: toUser(rows[0]) });
  });

  api.post('/me/password', requireUser, authLimiter, async (req, res) => {
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.next === 'string' ? req.body.next : '';
    if (next.length < 6) throw bad('New password must be at least 6 characters.');
    if (next.length > 72) throw bad('New password must be at most 72 characters.');
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!(await verifyPassword(current, rows[0]?.password_hash))) throw bad('Your current password is incorrect.');
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user!.id]);
    // Sign out every other device; this one stays signed in.
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user!.id, req.sessionHash]);
    res.json({ ok: true });
  });

  api.patch('/me/prefs', requireUser, async (req, res) => {
    const b = req.body ?? {};
    const prefs: NotifyPrefs = { ...req.user!.prefs };
    for (const k of ['tasks', 'checkin'] as const) {
      if (k in b) {
        if (typeof b[k] !== 'boolean') throw bad(`Invalid ${k}`);
        prefs[k] = b[k];
      }
    }
    if ('morning' in b) {
      if (b.morning !== 'off' && b.morning !== 'auto' && !isHm(b.morning)) throw bad('Invalid morning time');
      prefs.morning = b.morning;
    }
    if ('review' in b) {
      if (b.review !== 'off' && !isHm(b.review)) throw bad('Invalid review time');
      prefs.review = b.review;
    }
    // Only store what differs from the defaults, so improving a default reaches everyone who never changed it.
    const stored = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => DEFAULT_PREFS[k as keyof NotifyPrefs] !== v));
    const { rows } = await db.query<UserRow>('UPDATE users SET notify_prefs = $1 WHERE id = $2 RETURNING *', [JSON.stringify(stored), req.user!.id]);
    res.json({ user: toUser(rows[0]) });
  });

  /** Marks the first-login tutorial as finished (or skipped) so it doesn't show again on any device. */
  api.post('/me/onboarded', requireUser, async (req, res) => {
    const { rows } = await db.query<UserRow>('UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1 RETURNING *', [req.user!.id]);
    res.json({ user: toUser(rows[0]) });
  });

  // ---------- Tasks & goals ----------
  const ownTask = async (req: Request) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found');
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1 AND user_id = $2`, [id, req.user!.id]);
    if (!rows[0]) throw new HttpError(404, 'Task not found');
    return rows[0];
  };

  const checkLinks = async (userId: string, kind: 'week' | 'month', links: string[] | undefined, self?: string) => {
    if (!links?.length) return;
    if (self && links.includes(self)) throw bad('A goal cannot count itself');
    const allowed = kind === 'month' ? ['timed', 'week'] : ['timed'];
    const { rows } = await db.query<{ n: string }>(
      'SELECT count(*) AS n FROM tasks WHERE user_id = $1 AND id = ANY($2::uuid[]) AND kind = ANY($3::text[])',
      [userId, links, allowed],
    );
    if (Number(rows[0].n) !== links.length) throw bad('Some linked tasks no longer exist');
  };

  api.get('/tasks', requireUser, async (req, res) => {
    // Loading the plan means they opened the app: record it for the admin's "last active" (at most every 5 minutes).
    await db.query(`UPDATE users SET last_active_at = now() WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes')`, [req.user!.id]);
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 ORDER BY created_at`, [req.user!.id]);
    res.json({ tasks: rows.map(toTask) });
  });

  api.post('/tasks', requireUser, async (req, res) => {
    const kind = req.body?.kind;
    let row: Task;
    if (kind === 'week' || kind === 'month') {
      const g = goalInput(kind, req.body ?? {}, false) as GoalInput;
      if (!isYmd(req.body?.date)) throw bad('Invalid date');
      await checkLinks(req.user!.id, kind, g.links);
      ({ rows: [row] } = await db.query<Task>(
        `INSERT INTO tasks (user_id, kind, title, date, repeat, target, links) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${TASK_COLS}`,
        [req.user!.id, kind, g.title, req.body.date, g.repeat, g.target, JSON.stringify(g.links)],
      ));
    } else {
      const t = timedInput(req.body ?? {}, false) as TimedTaskInput;
      sameDay(t.start, t.dur);
      ({ rows: [row] } = await db.query<Task>(
        `INSERT INTO tasks (user_id, kind, title, date, start, dur, color, icon, repeat, remind)
         VALUES ($1, 'timed', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${TASK_COLS}`,
        [req.user!.id, t.title, t.date, t.start, t.dur, t.color, t.icon, t.repeat, t.remind],
      ));
    }
    res.status(201).json({ task: toTask(row) });
  });

  api.patch('/tasks/:id', requireUser, async (req, res) => {
    const task = await ownTask(req);
    if (task.kind !== 'timed') {
      const g = goalInput(task.kind, req.body ?? {}, true);
      await checkLinks(req.user!.id, task.kind, g.links, task.id);
      const keys = Object.keys(g) as (keyof GoalInput)[];
      if (!keys.length) return res.json({ task: toTask(task) });
      const sets = keys.map((k, i) => `"${k}" = $${i + 3}`).join(', ');
      const { rows } = await db.query<Task>(
        `UPDATE tasks SET ${sets} WHERE id = $1 AND user_id = $2 RETURNING ${TASK_COLS}`,
        [task.id, req.user!.id, ...keys.map((k) => (k === 'links' ? JSON.stringify(g.links) : g[k]))],
      );
      return res.json({ task: toTask(rows[0]) });
    }
    const patch = timedInput(req.body ?? {}, true);
    sameDay(patch.start ?? task.start!, patch.dur ?? task.dur!);
    const keys = Object.keys(patch) as (keyof TimedTaskInput)[];
    if (!keys.length) return res.json({ task: toTask(task) });
    const sets = keys.map((k, i) => `"${k}" = $${i + 3}`).join(', ');
    const { rows } = await db.query<Task>(
      `UPDATE tasks SET ${sets} WHERE id = $1 AND user_id = $2 RETURNING ${TASK_COLS}`,
      [task.id, req.user!.id, ...keys.map((k) => patch[k])],
    );
    res.json({ task: toTask(rows[0]) });
  });

  /** Flips completion for one occurrence (a day, week start or month key). */
  api.post('/tasks/:id/toggle', requireUser, async (req, res) => {
    const task = await ownTask(req);
    const key = req.body?.key;
    if (!isDoneKey(key)) throw bad('Invalid key');
    const { rows } = await db.query<Task>(
      `UPDATE tasks SET done = CASE WHEN COALESCE((done ->> $3)::boolean, false)
         THEN done - $3 ELSE done || jsonb_build_object($3::text, true) END
       WHERE id = $1 AND user_id = $2 RETURNING ${TASK_COLS}`,
      [task.id, req.user!.id, key],
    );
    res.json({ task: toTask(rows[0]) });
  });

  /** Marks one occurrence done (never undoes it): the "Done" button on a reminder. */
  api.post('/tasks/:id/done', requireUser, async (req, res) => {
    const task = await ownTask(req);
    const key = req.body?.key;
    if (!isDoneKey(key)) throw bad('Invalid key');
    const { rows } = await db.query<Task>(
      `UPDATE tasks SET done = done || jsonb_build_object($3::text, true) WHERE id = $1 AND user_id = $2 RETURNING ${TASK_COLS}`,
      [task.id, req.user!.id, key],
    );
    const t = toTask(rows[0]);
    res.json({ task: t, streak: isYmd(key) ? currentStreak(t, key) : 0 });
  });

  api.delete('/tasks/:id', requireUser, async (req, res) => {
    const task = await ownTask(req);
    await db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [task.id, req.user!.id]);
    // Goals that counted this task stop counting it.
    await db.query(`UPDATE tasks SET links = links - $2::text WHERE user_id = $1 AND links ? $2::text`, [req.user!.id, task.id]);
    res.json({ ok: true });
  });

  // ---------- Admin ----------
  const adminUsers = async (where = '', params: unknown[] = []) => {
    const { rows } = await db.query<UserRow & { task_count: string; goal_count: string; devices: string }>(
      `SELECT u.*,
         (SELECT count(*) FROM tasks t WHERE t.user_id = u.id AND t.kind = 'timed') AS task_count,
         (SELECT count(*) FROM tasks t WHERE t.user_id = u.id AND t.kind <> 'timed') AS goal_count,
         (SELECT count(*) FROM push_subscriptions p WHERE p.user_id = u.id) AS devices
       FROM users u ${where} ORDER BY u.created_at`,
      params,
    );
    return rows.map((r): AdminUser => ({
      ...toUser(r),
      taskCount: Number(r.task_count),
      goalCount: Number(r.goal_count),
      lastActive: r.last_active_at?.getTime() ?? null,
      devices: Number(r.devices),
    }));
  };

  const userId = (req: Request) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(404, 'User not found');
    return id;
  };

  api.get('/admin/overview', requireAdmin, async (_req, res) => {
    const users = await adminUsers();
    const { rows: [tc] } = await db.query<{ n: string }>('SELECT count(*) AS n FROM tasks');
    const weekAgo = Date.now() - 7 * 864e5;
    const stats: AdminStats = {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      newThisWeek: users.filter((u) => u.created > weekAgo).length,
      totalTasks: Number(tc.n),
    };
    res.json({ users, stats });
  });

  /** A customer's profile and plan, read-only, for support. */
  api.get('/admin/users/:id', requireAdmin, async (req, res) => {
    const [user] = await adminUsers('WHERE u.id = $1', [userId(req)]);
    if (!user) throw new HttpError(404, 'User not found');
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 ORDER BY created_at`, [user.id]);
    res.json({ user, tasks: rows.map(toTask) });
  });

  api.get('/admin/users.csv', requireAdmin, async (_req, res) => {
    const users = await adminUsers();
    const iso = (t: number | null) => (t === null ? '' : new Date(t).toISOString().slice(0, 10));
    // Quote every cell, and defuse values a spreadsheet would run as a formula.
    const cell = (v: string | number) => {
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['Name', 'Email', 'Role', 'Status', 'Joined', 'Last active', 'Tasks', 'Goals', 'Reminder devices'],
      ...users.map((u) => [u.name, u.email, u.role, u.status, iso(u.created), iso(u.lastActive), u.taskCount, u.goalCount, u.devices]),
    ].map((row) => row.map(cell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lockedin-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  });

  /** Push a message to one customer (userId) or to everyone with reminders turned on. */
  api.post('/admin/notify', requireAdmin, async (req, res) => {
    const title = str(req.body?.title, 80);
    const body = str(req.body?.body, 300);
    if (!title) throw bad('Add a title for the notification.');
    if (!body) throw bad('Add a message for the notification.');
    let ids: string[];
    if (req.body?.userId !== undefined) {
      const id = String(req.body.userId);
      if (!UUID_RE.test(id)) throw new HttpError(404, 'User not found');
      ids = [id];
    } else {
      const { rows } = await db.query<{ user_id: string }>(
        `SELECT DISTINCT p.user_id FROM push_subscriptions p JOIN users u ON u.id = p.user_id WHERE u.status = 'active'`,
      );
      ids = rows.map((r) => r.user_id);
    }
    const result: NotifyResult = { people: 0, devices: 0 };
    for (const id of ids) {
      const n = await sendToUser(db, id, { title, body, url: '/', tag: `admin-${Date.now()}` });
      if (n) {
        result.people++;
        result.devices += n;
      }
    }
    if (!result.devices) throw bad(req.body?.userId !== undefined ? 'This customer has no device with reminders turned on.' : 'No customers have reminders turned on yet.');
    res.json(result);
  });

  const otherUser = (req: Request) => {
    const id = userId(req);
    if (id === req.user!.id) throw bad('You cannot change your own account here.');
    return id;
  };

  api.patch('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = otherUser(req);
    const { role, status } = req.body ?? {};
    if (role !== undefined && role !== 'user' && role !== 'admin') throw bad('Invalid role');
    if (status !== undefined && status !== 'active' && status !== 'suspended') throw bad('Invalid status');
    const { rows } = await db.query<UserRow>(
      'UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status) WHERE id = $1 RETURNING *',
      [id, role ?? null, status ?? null],
    );
    if (!rows[0]) throw new HttpError(404, 'User not found');
    // A suspended user is signed out everywhere.
    if (status === 'suspended') await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    res.json({ user: toUser(rows[0]) });
  });

  api.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = otherUser(req);
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'User not found');
    res.json({ ok: true });
  });

  // ---------- Push reminders ----------
  pushRoutes(api, db);

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  app.use('/api', api);
  return app;
}
