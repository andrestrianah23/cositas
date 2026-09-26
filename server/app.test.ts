// Integration tests against a real Postgres. Point TEST_DATABASE_URL at a throwaway database;
// every table in it is dropped at the start of the run.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { ensureAdmin } from './seed';
import { initPush, localNow, sendDueReminders } from './push';

const db = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lockedin_test');
let server: Server;
let base = '';

/** A tiny cookie-keeping client, one per simulated browser. */
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json()) as any };
  };
}

const timed = { kind: 'timed', title: 'Yoga', date: '2026-09-01', start: '07:15', dur: 30, color: 1, icon: 'self_improvement', repeat: 'daily' };

before(async () => {
  await db.query('DROP TABLE IF EXISTS push_log, push_subscriptions, app_settings, tasks, sessions, users CASCADE');
  await migrate(db);
  await ensureAdmin(db, { ADMIN_EMAIL: 'Boss@Lockedin.app', ADMIN_PASSWORD: 'boss-pass' });
  await initPush(db, {});
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await db.end();
});

describe('auth', () => {
  test('sign up, read session, sign out', async () => {
    const c = client();
    const up = await c('POST', '/api/auth/signup', { name: ' Maya ', email: 'MAYA@example.com', password: 'maya123' });
    assert.equal(up.status, 201);
    assert.equal(up.body.user.email, 'maya@example.com');
    assert.equal(up.body.user.name, 'Maya');
    assert.equal(up.body.user.role, 'user');
    assert.equal(up.body.user.password_hash, undefined);
    assert.equal((await c('GET', '/api/me')).body.user.email, 'maya@example.com');
    await c('POST', '/api/auth/signout');
    assert.equal((await c('GET', '/api/me')).body.user, null);
  });

  test('rejects duplicate email, bad input and wrong password', async () => {
    const c = client();
    assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email: 'maya@example.com', password: 'whatever' })).body.error, 'An account with this email already exists.');
    assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email: 'nope', password: 'whatever' })).status, 400);
    assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email: 'x@y.co', password: '123' })).status, 400);
    assert.equal((await c('POST', '/api/auth/signin', { email: 'maya@example.com', password: 'wrong' })).body.error, 'Email or password is incorrect.');
    assert.equal((await c('POST', '/api/auth/signin', { email: 'ghost@example.com', password: 'wrong' })).status, 400);
    assert.equal((await c('POST', '/api/auth/signin', { email: 'Maya@Example.com', password: 'maya123' })).status, 200);
  });

  test('requires a JSON body for writes', async () => {
    const res = await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(res.status, 415);
  });

  test('ADMIN_EMAIL becomes an admin', async () => {
    const c = client();
    const r = await c('POST', '/api/auth/signin', { email: 'boss@lockedin.app', password: 'boss-pass' });
    assert.equal(r.body.user.role, 'admin');
  });
});

describe('tasks', () => {
  test('create, edit, toggle and delete; other users cannot touch them', async () => {
    const a = client(), b = client();
    await a('POST', '/api/auth/signup', { name: 'Ana', email: 'ana@example.com', password: 'ana-pass' });
    await b('POST', '/api/auth/signup', { name: 'Ben', email: 'ben@example.com', password: 'ben-pass' });

    const created = await a('POST', '/api/tasks', timed);
    assert.equal(created.status, 201);
    const id = created.body.task.id;
    assert.deepEqual(created.body.task.done, {});

    const edited = await a('PATCH', `/api/tasks/${id}`, { title: 'Morning yoga', dur: 45 });
    assert.equal(edited.body.task.title, 'Morning yoga');
    assert.equal(edited.body.task.dur, 45);
    assert.equal(edited.body.task.start, '07:15');

    assert.deepEqual((await a('POST', `/api/tasks/${id}/toggle`, { key: '2026-09-03' })).body.task.done, { '2026-09-03': true });
    assert.deepEqual((await a('POST', `/api/tasks/${id}/toggle`, { key: '2026-09-03' })).body.task.done, {});

    assert.equal((await b('GET', '/api/tasks')).body.tasks.length, 0);
    assert.equal((await b('PATCH', `/api/tasks/${id}`, { title: 'hacked' })).status, 404);
    assert.equal((await b('POST', `/api/tasks/${id}/toggle`, { key: '2026-09-03' })).status, 404);
    assert.equal((await b('DELETE', `/api/tasks/${id}`)).status, 404);

    assert.equal((await a('DELETE', `/api/tasks/${id}`)).status, 200);
    assert.equal((await a('GET', '/api/tasks')).body.tasks.length, 0);
  });

  test('validates timed task fields', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    for (const bad of [{ title: '  ' }, { date: '2026-02-30' }, { start: '25:00' }, { dur: 7 }, { color: 9 }, { icon: 'rocket' }, { repeat: 'yearly' }]) {
      assert.equal((await a('POST', '/api/tasks', { ...timed, ...bad })).status, 400, JSON.stringify(bad));
    }
  });

  test('weekly and monthly goals', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    const g = (await a('POST', '/api/tasks', { kind: 'month', title: 'Pay rent', date: '2026-09-26' })).body.task;
    assert.equal(g.kind, 'month');
    assert.equal(g.start, null);
    assert.deepEqual((await a('POST', `/api/tasks/${g.id}/toggle`, { key: '2026-09' })).body.task.done, { '2026-09': true });
    assert.equal((await a('PATCH', `/api/tasks/${g.id}`, { title: 'x' })).status, 400);
    assert.equal((await a('POST', `/api/tasks/${g.id}/toggle`, { key: 'bogus' })).status, 400);
  });

  test('requires sign-in', async () => {
    assert.equal((await client()('GET', '/api/tasks')).status, 401);
  });
});

describe('admin', () => {
  test('non-admins are refused', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    assert.equal((await a('GET', '/api/admin/overview')).status, 403);
  });

  test('overview, role change, suspend and delete', async () => {
    const admin = client(), ben = client();
    await admin('POST', '/api/auth/signin', { email: 'boss@lockedin.app', password: 'boss-pass' });
    await ben('POST', '/api/auth/signin', { email: 'ben@example.com', password: 'ben-pass' });
    await ben('POST', '/api/tasks', timed);

    const ov = await admin('GET', '/api/admin/overview');
    const benRow = ov.body.users.find((u: { email: string }) => u.email === 'ben@example.com');
    assert.equal(benRow.taskCount, 1);
    assert.equal(ov.body.stats.totalUsers, 4);

    const bossId = ov.body.users.find((u: { email: string }) => u.email === 'boss@lockedin.app').id;
    assert.equal((await admin('PATCH', `/api/admin/users/${bossId}`, { role: 'user' })).status, 400);
    assert.equal((await admin('DELETE', `/api/admin/users/${bossId}`)).status, 400);

    assert.equal((await admin('PATCH', `/api/admin/users/${benRow.id}`, { role: 'admin' })).body.user.role, 'admin');
    assert.equal((await admin('PATCH', `/api/admin/users/${benRow.id}`, { status: 'suspended' })).body.user.status, 'suspended');
    // Suspension ends Ben's existing session and blocks new sign-ins.
    assert.equal((await ben('GET', '/api/tasks')).status, 401);
    const r = await ben('POST', '/api/auth/signin', { email: 'ben@example.com', password: 'ben-pass' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'This account has been suspended by an administrator.');

    assert.equal((await admin('DELETE', `/api/admin/users/${benRow.id}`)).status, 200);
    const after = await admin('GET', '/api/admin/overview');
    assert.equal(after.body.stats.totalUsers, 3);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM tasks t JOIN users u ON u.id = t.user_id WHERE u.email = $1', ['ben@example.com']);
    assert.equal(rows[0].n, 0);
  });
});

describe('push reminders', () => {
  const sub = (n: number) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BExamplePublicKey', auth: 'authsecret' } });

  test('localNow reads the wall clock in a time zone', () => {
    const at = new Date('2026-09-26T13:05:00Z');
    assert.deepEqual(localNow('America/New_York', at), { ds: '2026-09-26', min: 9 * 60 + 5 });
    assert.deepEqual(localNow('Asia/Tokyo', at), { ds: '2026-09-26', min: 22 * 60 + 5 });
    assert.deepEqual(localNow('Pacific/Kiritimati', new Date('2026-09-26T13:05:00Z')), { ds: '2026-09-27', min: 3 * 60 + 5 });
  });

  test('subscribe validates input and requires sign-in', async () => {
    assert.equal((await client()('POST', '/api/push/subscribe', { subscription: sub(1), tz: 'UTC' })).status, 401);
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    assert.equal((await a('POST', '/api/push/subscribe', { subscription: { ...sub(1), endpoint: 'http://insecure' }, tz: 'UTC' })).status, 400);
    assert.equal((await a('POST', '/api/push/subscribe', { subscription: sub(1), tz: 'Mars/Olympus' })).status, 400);
    assert.equal((await a('POST', '/api/push/subscribe', { subscription: sub(1), tz: 'UTC' })).status, 200);
    assert.equal((await a('POST', '/api/push/unsubscribe', { endpoint: sub(1).endpoint })).status, 200);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM push_subscriptions');
    assert.equal(rows[0].n, 0);
  });

  test('sends one reminder when a task starts in the user’s time zone', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    await a('POST', '/api/push/subscribe', { subscription: sub(2), tz: 'America/New_York' });
    const daily = (await a('POST', '/api/tasks', { ...timed, title: 'Stretch', start: '09:00', date: '2026-09-01' })).body.task;
    const later = (await a('POST', '/api/tasks', { ...timed, title: 'Lunch', start: '12:30', date: '2026-09-01' })).body.task;
    const doneToday = (await a('POST', '/api/tasks', { ...timed, title: 'Walk', start: '09:00', date: '2026-09-01' })).body.task;
    await a('POST', `/api/tasks/${doneToday.id}/toggle`, { key: '2026-09-26' });

    const sent: { title: string }[] = [];
    const fake = async (_db: unknown, _user: string, p: { title: string }) => (sent.push(p), 1);
    const at = new Date('2026-09-26T13:01:00Z'); // 9:01 AM in New York
    await sendDueReminders(db, at, fake);
    await sendDueReminders(db, at, fake); // a second tick must not repeat it
    assert.deepEqual(sent.map((p) => p.title), ['Stretch']);
    assert.ok(!sent.some((p) => p.title === later.title));

    await sendDueReminders(db, new Date('2026-09-27T13:00:30Z'), fake); // the next day, daily again
    assert.deepEqual(sent.map((p) => p.title), ['Stretch', 'Stretch', 'Walk']);
    await db.query('DELETE FROM tasks WHERE id = ANY($1)', [[daily.id, later.id, doneToday.id]]);
  });
});
