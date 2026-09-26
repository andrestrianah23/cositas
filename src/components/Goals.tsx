import { useState } from 'react';
import type { Task } from '../../shared/types';

interface Props {
  title: string;
  placeholder: string;
  goals: Task[];
  doneKey: string;
  onAdd: (title: string) => Promise<boolean>;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}

export function Goals({ title, placeholder, goals, doneKey, onAdd, onToggle, onDelete }: Props) {
  const [text, setText] = useState('');
  const doneN = goals.filter((g) => g.done[doneKey]).length;

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    if (!(await onAdd(v))) setText(v);
  };

  return (
    <div className="card goals">
      <div className="goals-head">
        <div className="card-title">{title}</div>
        <div className="goals-count">{goals.length ? `${doneN}/${goals.length} done` : 'None yet'}</div>
      </div>
      {goals.map((g) => {
        const done = !!g.done[doneKey];
        return (
          <div className="goal" key={g.id}>
            <button className={`goal-check${done ? ' on' : ''}`} onClick={() => onToggle(g)} aria-label={done ? `Mark ${g.title} not done` : `Mark ${g.title} done`} aria-pressed={done}>
              <span className="ms">{done ? 'check' : ''}</span>
            </button>
            <div className={`goal-title${done ? ' done' : ''}`}>{g.title}</div>
            <button className="goal-del" onClick={() => onDelete(g)} aria-label={`Delete ${g.title}`}><span className="ms">close</span></button>
          </div>
        );
      })}
      <div className="goal-add">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={placeholder} maxLength={200} />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}
