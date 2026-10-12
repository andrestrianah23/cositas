import { addDays, DOW, fmtD, fmtT, parse, toMin, weekStart, ymd } from '../../shared/dates';
import type { Task } from '../../shared/types';
import { currentStreak, streakUnit } from '../../shared/stats';
import { circle, colorOf, DOT, FAINT, INK, LINE, REPEAT_LABEL } from '../theme';

interface Props {
  sel: string;
  today: string;
  onDay: (ds: string) => Task[];
  setSel: (ds: string) => void;
  /** Without onEdit/onToggle the timeline is read-only (the admin's view of a customer's plan). */
  onEdit?: (t: Task) => void;
  onToggle?: (t: Task, ds: string) => void;
}

/** "🔥 6 days" once a habit has been ticked at least twice in a row. */
function Streak({ t, asOf }: { t: Task; asOf: string }) {
  const n = currentStreak(t, asOf);
  if (n < 2) return null;
  return <span className="streak-chip" title={`${n} ${streakUnit(t)}s in a row`}><span className="ms">local_fire_department</span>{n} {streakUnit(t)}s</span>;
}

export function DayView({ sel, today, onDay, setSel, onEdit, onToggle }: Props) {
  const ws = weekStart(parse(sel));
  const items = onDay(sel);
  const doneN = items.filter((t) => t.done[sel]).length;
  const pct = items.length ? Math.round((doneN / items.length) * 100) : 0;

  return (
    <>
      <div className="strip">
        {DOW.map((dow, i) => {
          const ds = ymd(addDays(ws, i));
          return (
            <button key={ds} onClick={() => setSel(ds)} aria-label={ds} aria-pressed={ds === sel}>
              <span className="dow">{dow}</span>
              <span className="daynum" style={circle(ds, sel, today)}>{parse(ds).getDate()}</span>
              <span className="strip-dot" style={{ background: onDay(ds).length ? DOT : 'transparent' }} />
            </button>
          );
        })}
      </div>
      <div className="card timeline">
        <div className="progress">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <div className="progress-label mono">{doneN}/{items.length}</div>
        </div>
        {!items.length && (
          <div className="empty"><strong>Nothing planned</strong>{onEdit ? 'Tap + to add a task to this day.' : 'No tasks on this day.'}</div>
        )}
        {items.map((t, i) => {
          const st = toMin(t.start!), dur = t.dur!, en = st + dur, done = !!t.done[sel], nx = items[i + 1];
          const gap = nx ? toMin(nx.start!) - en : 0;
          const color = colorOf(t.color);
          const repeat = REPEAT_LABEL[t.repeat ?? 'none'];
          return (
            <div className="item" key={t.id}>
              <div className="item-start mono">{fmtT(st)}</div>
              <div className="item-rail">
                <button className="tile" disabled={!onEdit} onClick={() => onEdit?.(t)} aria-label={onEdit ? `Edit ${t.title}` : t.title} style={{ height: Math.min(52 + Math.max(0, dur - 15) * 0.8, 160), background: color, opacity: done ? 0.45 : 1 }}>
                  <span className="ms">{t.icon}</span>
                </button>
                <div className="rail-line" style={{ background: nx ? LINE : 'transparent' }} />
              </div>
              <div className="item-body" onClick={() => onEdit?.(t)} style={onEdit ? undefined : { cursor: 'default' }}>
                <div className="item-range mono">
                  {fmtT(st)} – {fmtT(en)} ({fmtD(dur)})
                  {repeat && <span className="repeat-chip"><span className="ms">repeat</span>{repeat}</span>}
                  <Streak t={t} asOf={sel < today ? sel : today} />
                </div>
                <div className="item-title" style={{ textDecoration: done ? 'line-through' : 'none', color: done ? FAINT : INK }}>{t.title}</div>
                {gap >= 30 && <div className="item-gap">{fmtD(gap)} free</div>}
              </div>
              <div className="item-check">
                <button className="check" disabled={!onToggle} onClick={() => onToggle?.(t, sel)} aria-label={done ? `Mark ${t.title} not done` : `Mark ${t.title} done`} aria-pressed={done} style={{ borderColor: color, background: done ? color : 'transparent' }}>
                  <span className="ms">{done ? 'check' : ''}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
