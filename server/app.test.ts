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

// The suite signs in far more often than the production limit allows.
process.env.AUTH_RATE_LIMIT = '1000';

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
    for (const bad of [{ title: '  ' }, { date: '2026-02-30' }, { start: '25:00' }, { dur: 0 }, { dur: 1441 }, { dur: 2.5 }, { color: 9 }, { icon: 'rocket' }, { repeat: 'yearly' }]) {
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
    assert.equal((await a('PATCH', `/api/tasks/${g.id}`, { title: 'Pay rent early' })).body.task.title, 'Pay rent early');
    assert.equal((await a('PATCH', `/api/tasks/${g.id}`, { start: '09:00' })).body.task.start, null);
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

describe('onboarding and customer access', () => {
  test('tutorial is shown once per account', async () => {
    const c = client();
    const up = await c('POST', '/api/auth/signup', { name: 'Newbie', email: 'new@example.com', password: 'new-pass' });
    assert.equal(up.body.user.onboarded, false);
    assert.equal((await c('POST', '/api/me/onboarded')).body.user.onboarded, true);
    const other = client();
    assert.equal((await other('POST', '/api/auth/signin', { email: 'new@example.com', password: 'new-pass' })).body.user.onboarded, true);
  });

  test('admin sees customer details, plan and CSV; customers cannot', async () => {
    const admin = client(), cust = client();
    await admin('POST', '/api/auth/signin', { email: 'boss@lockedin.app', password: 'boss-pass' });
    await cust('POST', '/api/auth/signin', { email: 'new@example.com', password: 'new-pass' });
    await cust('POST', '/api/tasks', { ...timed, title: '=HYPERLINK("x")' });
    await cust('POST', '/api/tasks', { kind: 'week', title: 'Read a book', date: '2026-09-26' });
    await cust('GET', '/api/tasks');

    const ov = await admin('GET', '/api/admin/overview');
    const row = ov.body.users.find((u: { email: string }) => u.email === 'new@example.com');
    assert.equal(row.taskCount, 1);
    assert.equal(row.goalCount, 1);
    assert.ok(row.lastActive > Date.now() - 60_000);
    assert.equal(row.devices, 0);

    const detail = await admin('GET', `/api/admin/users/${row.id}`);
    assert.equal(detail.body.user.email, 'new@example.com');
    assert.equal(detail.body.tasks.length, 2);
    assert.equal((await cust('GET', `/api/admin/users/${row.id}`)).status, 403);

    const res = await fetch(base + '/api/admin/users.csv', { headers: { Cookie: (await signInCookie('boss@lockedin.app', 'boss-pass')) } });
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="lockedin-customers-/);
    const csv = await res.text();
    assert.match(csv, /"Name","Email","Role"/);
    assert.match(csv, /"Newbie","new@example.com","user","active"/);
    assert.equal((await cust('GET', '/api/admin/users.csv')).status, 403);
  });

  test('admin notifications validate input and report when nobody can receive them', async () => {
    const admin = client(), cust = client();
    await admin('POST', '/api/auth/signin', { email: 'boss@lockedin.app', password: 'boss-pass' });
    await cust('POST', '/api/auth/signin', { email: 'new@example.com', password: 'new-pass' });
    assert.equal((await admin('POST', '/api/admin/notify', { title: '', body: 'x' })).status, 400);
    const none = await admin('POST', '/api/admin/notify', { title: 'Hi', body: 'News' });
    assert.equal(none.status, 400);
    assert.equal(none.body.error, 'No customers have reminders turned on yet.');
    assert.equal((await cust('POST', '/api/admin/notify', { title: 'Hi', body: 'News' })).status, 403);
  });
});

async function signInCookie(email: string, password: string) {
  const res = await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('end times, linked goals and password', () => {
  test('tasks take any length but must end by midnight', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    assert.equal((await a('POST', '/api/tasks', { ...timed, dur: 7 })).status, 201);
    const late = await a('POST', '/api/tasks', { ...timed, title: 'Late', start: '22:00', dur: 120 });
    assert.equal(late.status, 201, 'ending exactly at midnight is fine');
    const over = await a('POST', '/api/tasks', { ...timed, title: 'Night shift', start: '22:00', dur: 121 });
    assert.equal(over.status, 400);
    assert.match(over.body.error, /end by midnight/);
    // Moving a task later can't push it past midnight either.
    assert.equal((await a('PATCH', `/api/tasks/${late.body.task.id}`, { start: '22:30' })).status, 400);
    assert.equal((await a('PATCH', `/api/tasks/${late.body.task.id}`, { start: '22:30', dur: 90 })).status, 200);
    assert.equal((await a('POST', '/api/tasks', { ...timed, start: '00:00', dur: 1440 })).status, 201);
    await db.query("DELETE FROM tasks WHERE title IN ('Late', 'Yoga') AND user_id = (SELECT id FROM users WHERE email = 'ana@example.com')");
  });

  test('goals carry a target, repeat and links to the owner’s own tasks', async () => {
    const a = client(), b = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    await b('POST', '/api/auth/signin', { email: 'new@example.com', password: 'new-pass' });
    const gym = (await a('POST', '/api/tasks', { ...timed, title: 'Gym', start: '18:00', dur: 60 })).body.task;
    const theirs = (await b('POST', '/api/tasks', { ...timed, title: 'Theirs' })).body.task;

    const goal = await a('POST', '/api/tasks', { kind: 'week', title: 'Gym 4x', date: '2026-09-28', repeat: 'weekly', target: 4, links: [gym.id] });
    assert.equal(goal.status, 201);
    assert.equal(goal.body.task.target, 4);
    assert.deepEqual(goal.body.task.links, [gym.id]);
    assert.equal(goal.body.task.repeat, 'weekly');

    assert.equal((await a('POST', '/api/tasks', { kind: 'week', title: 'x', date: '2026-09-28', links: [theirs.id] })).status, 400);
    assert.equal((await a('POST', '/api/tasks', { kind: 'week', title: 'x', date: '2026-09-28', repeat: 'monthly' })).status, 400);
    assert.equal((await a('POST', '/api/tasks', { kind: 'week', title: 'x', date: '2026-09-28', target: 0 })).status, 400);
    // A weekly goal can't count another weekly goal; a monthly one can.
    assert.equal((await a('POST', '/api/tasks', { kind: 'week', title: 'x', date: '2026-09-28', links: [goal.body.task.id] })).status, 400);
    const month = await a('POST', '/api/tasks', { kind: 'month', title: 'Gym every week', date: '2026-10-01', target: 4, links: [goal.body.task.id] });
    assert.equal(month.status, 201);

    const edited = await a('PATCH', `/api/tasks/${goal.body.task.id}`, { title: 'Gym 3x', target: 3 });
    assert.equal(edited.body.task.title, 'Gym 3x');
    assert.equal(edited.body.task.target, 3);
    assert.equal((await a('PATCH', `/api/tasks/${goal.body.task.id}`, { links: [goal.body.task.id] })).status, 400);

    // Deleting a linked task removes it from the goal.
    await a('DELETE', `/api/tasks/${gym.id}`);
    const after = (await a('GET', '/api/tasks')).body.tasks.find((t: { id: string }) => t.id === goal.body.task.id);
    assert.deepEqual(after.links, []);
    await db.query('DELETE FROM tasks WHERE id = ANY($1)', [[goal.body.task.id, month.body.task.id, theirs.id]]);
  });

  test('changing the password checks the old one and signs out other devices', async () => {
    const here = client(), there = client();
    await here('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    await there('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    assert.equal((await here('POST', '/api/me/password', { current: 'wrong', next: 'brand-new' })).body.error, 'Your current password is incorrect.');
    assert.equal((await here('POST', '/api/me/password', { current: 'ana-pass', next: '123' })).status, 400);
    assert.equal((await here('POST', '/api/me/password', { current: 'ana-pass', next: 'brand-new' })).status, 200);
    assert.equal((await here('GET', '/api/me')).body.user.email, 'ana@example.com');
    assert.equal((await there('GET', '/api/me')).body.user, null);
    assert.equal((await client()('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' })).status, 400);
    assert.equal((await client()('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'brand-new' })).status, 200);
    await here('POST', '/api/me/password', { current: 'brand-new', next: 'ana-pass' });
  });

  test('evening check-in: two hours after the last task, once, only when something is unticked', async () => {
    const a = client();
    await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'ana-pass' });
    await db.query("DELETE FROM tasks WHERE user_id = (SELECT id FROM users WHERE email = 'ana@example.com')");
    await a('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example.com/send/9', keys: { p256dh: 'k', auth: 'a' } }, tz: 'UTC' });
    const t1 = (await a('POST', '/api/tasks', { ...timed, title: 'Gym', start: '18:00', dur: 60, date: '2026-10-01' })).body.task;
    await a('POST', '/api/tasks', { ...timed, title: 'Read', start: '21:00', dur: 30, date: '2026-10-01' });
    await a('POST', `/api/tasks/${t1.id}/toggle`, { key: '2026-10-05' });

    const sent: { title: string; body: string; url?: string }[] = [];
    const fake = async (_db: unknown, _u: string, p: { title: string; body: string; url?: string }) => (sent.push(p), 1);
    const checkins = () => sent.filter((p) => p.title.startsWith('Quick check-in'));

    await sendDueReminders(db, new Date('2026-10-05T23:20:00Z'), fake); // last task ends 21:30, so not yet
    assert.equal(checkins().length, 0);
    await sendDueReminders(db, new Date('2026-10-05T23:31:00Z'), fake);
    await sendDueReminders(db, new Date('2026-10-05T23:45:00Z'), fake);
    assert.equal(checkins().length, 1);
    assert.equal(checkins()[0].title, 'Quick check-in: 1 task to tick');
    assert.match(checkins()[0].body, /Did you get to Read\?/);
    assert.equal(checkins()[0].url, '/?day=2026-10-05');

    // A day with everything ticked gets no check-in.
    for (const t of (await a('GET', '/api/tasks')).body.tasks) await a('POST', `/api/tasks/${t.id}/toggle`, { key: '2026-10-06' });
    await sendDueReminders(db, new Date('2026-10-06T23:35:00Z'), fake);
    assert.equal(checkins().length, 1);

    // A late last task puts the check-in after midnight, still about the right day.
    await a('POST', '/api/tasks', { ...timed, title: 'Night walk', start: '23:00', dur: 30, date: '2026-10-07', repeat: 'none' });
    await sendDueReminders(db, new Date('2026-10-08T01:31:00Z'), fake);
    assert.equal(checkins().length, 2);
    assert.equal(checkins()[1].url, '/?day=2026-10-07');
    assert.match(checkins()[1].body, /Gym, Read and Night walk/);
    await db.query("DELETE FROM push_subscriptions WHERE endpoint = 'https://push.example.com/send/9'");
  });
});
