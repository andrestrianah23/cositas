import { useState } from 'react';
import { goalProgress } from '../../shared/goals';
import type { Task } from '../../shared/types';

interface Props {
  title: string;
  placeholder: string;
  /** Goals that belong to this week or month. */
  goals: Task[];
  /** The week (its Monday) or month (YYYY-MM) being shown. */
  periodKey: string;
  /** Every task, so linked goals can count ticks. */
  tasks: Task[];
  /** Without the handlers the list is read-only. */
  onAdd?: (title: string) => Promise<boolean>;
  onToggle?: (t: Task) => void;
  onEdit?: (t: Task) => void;
  onDelete?: (t: Task) => void;
}

export function Goals({ title, placeholder, goals, periodKey, tasks, onAdd, onToggle, onEdit, onDelete }: Props) {
  const [text, setText] = useState('');
  const rows = goals.map((g) => ({ g, p: goalProgress(g, periodKey, tasks) }));
  const doneN = rows.filter((r) => r.p.done).length;

  const add = async () => {
    const v = text.trim();
    if (!v || !onAdd) return;
    setText('');
    if (!(await onAdd(v))) setText(v);
  };

  return (
    <div className="card goals">
      <div className="goals-head">
        <div className="card-title">{title}</div>
        <div className="goals-count">{goals.length ? `${doneN}/${goals.length} done` : 'None yet'}</div>
      </div>
      {rows.map(({ g, p }) => {
        const linked = p.count !== null;
        const names = g.links.map((id) => tasks.find((t) => t.id === id)?.title).filter(Boolean);
        return (
          <div className="goal" key={g.id}>
            <button
              className={`goal-check${p.done ? ' on' : ''}`}
              disabled={!onToggle || p.auto}
              title={p.auto ? 'Done automatically: you reached your target' : undefined}
              onClick={() => onToggle?.(g)}
              aria-label={p.done ? `Mark ${g.title} not done` : `Mark ${g.title} done`}
              aria-pressed={p.done}
            >
              <span className="ms">{p.done ? 'check' : ''}</span>
            </button>
            <div className={`goal-main${onEdit ? ' clickable' : ''}`} onClick={() => onEdit?.(g)} role={onEdit ? 'button' : undefined} tabIndex={onEdit ? 0 : undefined} onKeyDown={(e) => onEdit && e.key === 'Enter' && onEdit(g)}>
              <div className="goal-title">
                <span className={`goal-name${p.done ? ' done' : ''}`}>{g.title}</span>
                {(g.repeat === 'weekly' || g.repeat === 'monthly') && <span className="repeat-chip"><span className="ms">repeat</span>{g.repeat === 'weekly' ? 'Every week' : 'Every month'}</span>}
              </div>
              {linked && (
                <div className="goal-progress">
                  <div className="goal-bar"><span style={{ width: `${Math.min(100, (p.count! / p.target!) * 100)}%` }} /></div>
                  <span>{p.auto ? <><strong>{p.count} of {p.target}</strong> · done automatically</> : <><strong>{p.count} of {p.target}</strong> · from {names.join(', ') || 'linked tasks'}</>}</span>
                </div>
              )}
            </div>
            {onDelete && <button className="goal-del" onClick={() => onDelete(g)} aria-label={`Delete ${g.title}`}><span className="ms">close</span></button>}
          </div>
        );
      })}
      {onEdit && rows.some((r) => r.p.count === null) && (
        <div className="goal-hint"><span className="ms">link</span>Tip: tap a goal to link it to your daily tasks and it ticks itself.</div>
      )}
      {onAdd && <div className="goal-add">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={placeholder} maxLength={200} />
        <button onClick={add}>Add</button>
      </div>}
    </div>
  );
}
