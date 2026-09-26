import { addDays, DOW, parse, weekStart, ymd } from '../../shared/dates';
import type { Task } from '../../shared/types';
import { circle, colorOf, DOT } from '../theme';

interface Props {
  sel: string;
  today: string;
  isWide: boolean;
  onDay: (ds: string) => Task[];
  pickDay: (ds: string) => void;
}

export function MonthView({ sel, today, isWide, onDay, pickDay }: Props) {
  const d = parse(sel);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const gs = weekStart(first);
  const cells = Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) * 7;

  return (
    <div className="card month">
      <div className="month-grid">
        {DOW.map((w) => <div className="month-dow" key={w}>{w}</div>)}
        {[...Array(cells)].map((_, i) => {
          const day = addDays(gs, i), ds = ymd(day);
          const its = onDay(ds);
          return (
            <button key={ds} className="month-cell" onClick={() => pickDay(ds)} aria-label={`Open ${ds}`} style={{ minHeight: isWide ? 84 : 58, opacity: day.getMonth() === d.getMonth() ? 1 : 0.35 }}>
              <span className="daynum" style={circle(ds, sel, today)}>{day.getDate()}</span>
              <span className="month-dots">
                {its.slice(0, isWide ? 8 : 4).map((t) => <span key={t.id} style={{ background: t.done[ds] ? DOT : colorOf(t.color) }} />)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
