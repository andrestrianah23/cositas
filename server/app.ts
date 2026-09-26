import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { endSession, hashPassword, loadUser, requireAdmin, requireUser, startSession, verifyPassword } from './auth';
import { TASK_COLS, toTask, toUser, type Db, type UserRow } from './db';
import { isDoneKey, isHm, isYmd } from '../shared/dates';
import { COLOR_COUNT, DURATIONS, ICONS, REPEATS, type AdminStats, type AdminUser, type Task, type TimedTaskInput } from '../shared/types';

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
    if (!DURATIONS.includes(b.dur as number)) throw bad('Invalid duration');
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
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });

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

  // ---------- Tasks & goals ----------
  const ownTask = async (req: Request) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found');
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1 AND user_id = $2`, [id, req.user!.id]);
    if (!rows[0]) throw new HttpError(404, 'Task not found');
    return rows[0];
  };

  api.get('/tasks', requireUser, async (req, res) => {
    const { rows } = await db.query<Task>(`SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 ORDER BY created_at`, [req.user!.id]);
    res.json({ tasks: rows.map(toTask) });
  });

  api.post('/tasks', requireUser, async (req, res) => {
    const kind = req.body?.kind;
    let row: Task;
    if (kind === 'week' || kind === 'month') {
      const title = str(req.body?.title, 200);
      if (!title) throw bad('Goal cannot be empty');
      if (!isYmd(req.body?.date)) throw bad('Invalid date');
      ({ rows: [row] } = await db.query<Task>(
        `INSERT INTO tasks (user_id, kind, title, date) VALUES ($1, $2, $3, $4) RETURNING ${TASK_COLS}`,
        [req.user!.id, kind, title, req.body.date],
      ));
    } else {
      const t = timedInput(req.body ?? {}, false) as TimedTaskInput;
      ({ rows: [row] } = await db.query<Task>(
        `INSERT INTO tasks (user_id, kind, title, date, start, dur, color, icon, repeat)
         VALUES ($1, 'timed', $2, $3, $4, $5, $6, $7, $8) RETURNING ${TASK_COLS}`,
        [req.user!.id, t.title, t.date, t.start, t.dur, t.color, t.icon, t.repeat],
      ));
    }
    res.status(201).json({ task: toTask(row) });
  });

  api.patch('/tasks/:id', requireUser, async (req, res) => {
    const task = await ownTask(req);
    if (task.kind !== 'timed') throw bad('Goals cannot be edited');
    const patch = timedInput(req.body ?? {}, true);
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

  api.delete('/tasks/:id', requireUser, async (req, res) => {
    const task = await ownTask(req);
    await db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [task.id, req.user!.id]);
    res.json({ ok: true });
  });

  // ---------- Admin ----------
  api.get('/admin/overview', requireAdmin, async (_req, res) => {
    const { rows } = await db.query<UserRow & { task_count: string }>(
      `SELECT u.*, (SELECT count(*) FROM tasks t WHERE t.user_id = u.id) AS task_count
       FROM users u ORDER BY u.created_at`,
    );
    const { rows: [tc] } = await db.query<{ n: string }>('SELECT count(*) AS n FROM tasks');
    const weekAgo = Date.now() - 7 * 864e5;
    const users: AdminUser[] = rows.map((r) => ({ ...toUser(r), taskCount: Number(r.task_count) }));
    const stats: AdminStats = {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      newThisWeek: users.filter((u) => u.created > weekAgo).length,
      totalTasks: Number(tc.n),
    };
    res.json({ users, stats });
  });

  const otherUser = (req: Request) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(404, 'User not found');
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
