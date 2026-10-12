import { useEffect, useMemo, useState } from 'react';
import { fmtT, toMin } from '../../shared/dates';
import { MAX_TARGET, type GoalInput, type Task } from '../../shared/types';
import { colorOf, REPEAT_LABEL } from '../theme';

interface Props {
  goal: Task;
  tasks: Task[];
  isWide: boolean;
  onClose: () => void;
  onSave: (input: GoalInput) => Promise<void>;
  onDelete: () => Promise<void>;
  flash: (m: string) => void;
}

/** Edit a weekly or monthly goal: name, repeat, and the daily tasks (or weekly goals) that count toward it. */
export function GoalSheet({ goal, tasks, isWide, onClose, onSave, onDelete, flash }: Props) {
  const week = goal.kind === 'week';
  const per = week ? 'week' : 'month';
  const [title, setTitle] = useState(goal.title);
  const [repeat, setRepeat] = useState<GoalInput['repeat']>(goal.repeat === 'weekly' || goal.repeat === 'monthly' ? goal.repeat : 'none');
  const [target, setTarget] = useState<number | null>(goal.target);
  const [links, setLinks] = useState<string[]>(goal.links ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const daily = useMemo(() => tasks.filter((t) => t.kind === 'timed').sort((a, b) => toMin(a.start!) - toMin(b.start!)), [tasks]);
  const weeklyGoals = useMemo(() => (week ? [] : tasks.filter((t) => t.kind === 'week' && t.id !== goal.id)), [tasks, week, goal.id]);
  const tracking = target !== null;

  const flip = (id: string) => setLinks((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const step = (d: number) => setTarget((t) => Math.min(MAX_TARGET, Math.max(1, (t ?? 1) + d)));

  const save = async () => {
    if (!title.trim()) return flash('Give your goal a name');
    if (tracking && !links.length) return flash(`Pick at least one ${week ? 'task' : 'task or weekly goal'} to count`);
    setBusy(true);
    try {
      await onSave({ title: title.trim(), repeat, target: tracking ? target : null, links: tracking ? links : [] });
    } finally {
      setBusy(false);
    }
  };

  const linkRow = (t: Task, sub: string) => {
    const on = links.includes(t.id);
    return (
      <button key={t.id} className={`link-row${on ? ' on' : ''}`} role="checkbox" aria-checked={on} onClick={() => flip(t.id)}>
        {t.kind === 'timed'
          ? <span className="link-tile" style={{ background: colorOf(t.color) }}><span className="ms">{t.icon}</span></span>
          : <span className="link-tile goal"><span className="ms">flag</span></span>}
        <span className="link-text"><strong>{t.title}</strong><span>{sub}</span></span>
        <span className="link-box"><span className="ms">{on ? 'check' : ''}</span></span>
      </button>
    );
  };

  return (
    <div className="scrim" onClick={onClose} style={{ alignItems: isWide ? 'center' : 'flex-end' }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Edit goal" onClick={(e) => e.stopPropagation()} style={{ borderRadius: isWide ? 24 : '24px 24px 0 0', paddingBottom: isWide ? 24 : 'calc(24px + env(safe-area-inset-bottom))' }}>
        <div className="sheet-head">
          <div className="sheet-title">{week ? 'Weekly goal' : 'Monthly goal'}</div>
          <button className="sheet-close" onClick={onClose} aria-label="Close"><span className="ms">close</span></button>
        </div>
        <div className="sheet-name">
          <div className="sheet-swatch" style={{ background: 'var(--accent)' }}><span className="ms">flag</span></div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={week ? 'e.g. Gym 4 times' : 'e.g. Read 20 days'} maxLength={200} />
        </div>

        <div className="sheet-section">
          <div className="sheet-label">Repeat</div>
          <div className="seg repeat-seg">
            <button className={repeat === 'none' ? 'on' : ''} onClick={() => setRepeat('none')}>This {per} only</button>
            <button className={repeat !== 'none' ? 'on' : ''} onClick={() => setRepeat(week ? 'weekly' : 'monthly')}>Every {per}</button>
          </div>
        </div>

        <div className="sheet-section">
          <div className="sheet-label">Track it automatically</div>
          {!tracking ? (
            <button className="track-start" onClick={() => setTarget(week ? 4 : 12)}>
              <span className="ms">link</span>
              <span><strong>Count it from my {week ? 'daily tasks' : 'tasks'}</strong><span>Each tick counts. Reach your number and the goal ticks itself.</span></span>
            </button>
          ) : (
            <div className="track">
              <div className="stepper">
                <button onClick={() => step(-1)} aria-label="Fewer"><span className="ms">remove</span></button>
                <div><strong>{target}</strong><span>{target === 1 ? 'time' : 'times'} a {per}</span></div>
                <button onClick={() => step(1)} aria-label="More"><span className="ms">add</span></button>
              </div>
              <div className="link-help">Counts when you tick:</div>
              <div className="link-list">
                {daily.map((t) => linkRow(t, `${fmtT(toMin(t.start!))}${t.repeat && t.repeat !== 'none' ? ` · ${REPEAT_LABEL[t.repeat]}` : ''}`))}
                {!daily.length && <div className="install-sub">Add a task to your day first, then link it here.</div>}
              </div>
              {weeklyGoals.length > 0 && (
                <>
                  <div className="link-help">Or count the weeks you meet a weekly goal:</div>
                  <div className="link-list">{weeklyGoals.map((g) => linkRow(g, g.repeat === 'weekly' ? 'Every week' : 'One week'))}</div>
                </>
              )}
              <button className="nudge-later" style={{ alignSelf: 'flex-start' }} onClick={() => { setTarget(null); setLinks([]); }}>Stop tracking automatically</button>
            </div>
          )}
        </div>

        <div className="sheet-actions">
          <button className="danger" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>Delete</button>
          <button className="save" disabled={busy} onClick={save}>Save goal</button>
        </div>
      </div>
    </div>
  );
}
