import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { toUser, type Db, type UserRow } from './db';
import type { User } from '../shared/types';

export const COOKIE = 'lockedin_session';
const SESSION_DAYS = 30;
// Compared against when an email is unknown, so sign-in takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('lockedin-timing-guard', 10);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionHash?: string;
    }
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);

export async function verifyPassword(pw: string, hash: string | undefined) {
  const ok = await bcrypt.compare(pw, hash ?? DUMMY_HASH);
  return ok && hash !== undefined;
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export async function startSession(db: Db, req: Request, res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Behind Railway's HTTPS proxy req.secure is true (trust proxy is on); plain-http localhost stays usable.
    secure: req.secure,
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
}

export async function endSession(db: Db, req: Request, res: Response) {
  if (req.sessionHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attaches req.user when the request carries a valid session for an active account. */
export const loadUser = (db: Db) => async (req: Request, _res: Response, next: NextFunction) => {
  const token = readCookie(req, COOKIE);
  if (!token) return next();
  const hash = sha256(token);
  const { rows } = await db.query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [hash],
  );
  if (rows[0]) {
    req.user = toUser(rows[0]);
    req.sessionHash = hash;
  }
  next();
};

export const requireUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrators only.' });
  next();
};
