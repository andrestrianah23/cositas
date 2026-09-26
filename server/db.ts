import pg from 'pg';
import type { Task, User } from '../shared/types';

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('timed', 'week', 'month')),
  title text NOT NULL,
  date text NOT NULL,
  start text,
  dur integer,
  color integer,
  icon text,
  repeat text CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly')),
  done jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
`;

export async function migrate(db: Db) {
  await db.query(SCHEMA);
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: User['role'];
  status: User['status'];
  created_at: Date;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  status: r.status,
  created: r.created_at.getTime(),
});

export const TASK_COLS = 'id, kind, title, date, start, dur, color, icon, repeat, done';
export const toTask = (r: Task): Task => ({ ...r, done: r.done ?? {} });
