import { MONTHS } from '../../shared/dates';
import type { User } from '../../shared/types';

export const fmtDate = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
};

/** "just now", "12 min ago", "3 h ago", "yesterday", "5 days ago", or a date. */
export const ago = (t: number) => {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 5) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(t);
};

export function Badges({ u }: { u: Pick<User, 'role' | 'status'> }) {
  const ad = u.role === 'admin', active = u.status === 'active';
  return (
    <>
      <span className="badge" style={{ background: ad ? 'oklch(0.94 0.04 290)' : '#f0ece7', color: ad ? 'oklch(0.42 0.14 290)' : '#5b544d' }}>{ad ? 'Admin' : 'User'}</span>
      <span className="badge" style={{ background: active ? 'oklch(0.94 0.05 150)' : 'oklch(0.95 0.03 30)', color: active ? 'oklch(0.42 0.12 150)' : 'oklch(0.45 0.14 30)' }}>{active ? 'Active' : 'Suspended'}</span>
    </>
  );
}
