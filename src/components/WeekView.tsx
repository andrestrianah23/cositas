import { addDays, DOW, parse, weekStart, ymd } from '../../shared/dates';
import type { Task } from '../../shared/types';
import { circle, colorOf } from '../theme';

interface Props {
  sel: string;
  today: string;
  isWide: boolean;
  onDay: (ds: string) => Task[];
  pickDay: (ds: string) => void;
  onEdit: (t: Task, ds: string) => void;
}

export function WeekView({ sel, today, isWide, onDay, pickDay, onEdit }: Props) {
  const ws = weekStart(parse(sel));
  return (
    <div className="week">
      {DOW.map((dow, i) => {
        const ds = ymd(addDays(ws, i));
        return (
          <div className="week-col" key={ds}>
            <button className="week-head" onClick={() => pickDay(ds)} aria-label={`Open ${ds}`}>
              <span className="dow">{dow}</span>
              <span className="daynum" style={circle(ds, sel, today)}>{parse(ds).getDate()}</span>
            </button>
            <div className="week-lane">
              {onDay(ds).map((t) => (
                <button key={t.id} className="week-item" title={t.title} onClick={() => onEdit(t, ds)} style={{ background: colorOf(t.color), opacity: t.done[ds] ? 0.4 : 1, minHeight: Math.min(34 + t.dur! * 0.25, 80) }}>
                  <span className="ms">{t.icon}</span>
                  {isWide && <span className="week-item-title">{t.title}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
