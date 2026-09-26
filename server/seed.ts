import { hashPassword } from './auth';
import type { Db } from './db';
import { addDays, ymd } from '../shared/dates';

/** Ensures the administrator from ADMIN_EMAIL / ADMIN_PASSWORD exists and has the admin role. */
export async function ensureAdmin(db: Db, env = process.env) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !env.ADMIN_PASSWORD) return;
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (rows[0]) {
    await db.query("UPDATE users SET role = 'admin', status = 'active' WHERE id = $1", [rows[0].id]);
    return;
  }
  await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')", [
    env.ADMIN_NAME?.trim() || 'Admin',
    email,
    await hashPassword(env.ADMIN_PASSWORD),
  ]);
  console.log(`Created administrator ${email}`);
}

const ROUTINE: [string, string, number, number, string, string][] = [
  ['Wake up', '07:00', 15, 0, 'alarm', 'daily'],
  ['Yoga', '07:15', 30, 1, 'self_improvement', 'daily'],
  ['Get ready', '07:45', 30, 5, 'shower', 'daily'],
  ['Bike to office', '08:15', 30, 2, 'directions_bike', 'daily'],
  ['Deep work', '09:00', 120, 4, 'work', 'daily'],
  ['Lunch', '12:30', 45, 3, 'restaurant', 'daily'],
  ['Team sync', '14:00', 60, 6, 'groups', 'weekly'],
  ['Gym', '18:00', 60, 7, 'fitness_center', 'daily'],
  ['Read', '21:30', 30, 1, 'menu_book', 'daily'],
];
const GOALS: [string, 'week' | 'month'][] = [
  ['Finish project brief', 'week'],
  ['Call mom', 'week'],
  ['Pay rent', 'month'],
  ['Book dentist appointment', 'month'],
];

/** Demo accounts from the design prototype, for local development. Only runs on an empty database. */
export async function seedDemo(db: Db) {
  const { rows: [{ n }] } = await db.query<{ n: string }>('SELECT count(*) AS n FROM users');
  if (Number(n) > 0) return;
  const day = 864e5;
  const people: [string, string, string, string, string, number][] = [
    ['Admin', 'admin@lockedin.app', 'admin123', 'admin', 'active', 40],
    ['Maya Chen', 'maya@example.com', 'maya123', 'user', 'active', 6],
    ['Jonas Weber', 'jonas@example.com', 'jonas123', 'user', 'active', 2],
    ['Priya Nair', 'priya@example.com', 'priya123', 'user', 'suspended', 18],
  ];
  const start = ymd(addDays(new Date(), -14)), today = ymd(new Date());
  for (const [name, email, pw, role, status, age] of people) {
    const { rows: [u] } = await db.query<{ id: string }>(
      'INSERT INTO users (name, email, password_hash, role, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email, await hashPassword(pw), role, status, new Date(Date.now() - age * day)],
    );
    if (email !== 'admin@lockedin.app' && email !== 'maya@example.com') continue;
    for (const [title, st, dur, color, icon, repeat] of ROUTINE) {
      await db.query(
        "INSERT INTO tasks (user_id, kind, title, date, start, dur, color, icon, repeat) VALUES ($1, 'timed', $2, $3, $4, $5, $6, $7, $8)",
        [u.id, title, start, st, dur, color, icon, repeat],
      );
    }
    for (const [title, kind] of GOALS) {
      await db.query('INSERT INTO tasks (user_id, kind, title, date) VALUES ($1, $2, $3, $4)', [u.id, kind, title, today]);
    }
  }
  console.log('Seeded demo accounts');
}
