import { useEffect, useState } from 'react';
import { fmtD } from '../../shared/dates';
import { DURATIONS, ICONS, REPEATS, type TimedTaskInput } from '../../shared/types';
import { COLORS, INK, LABEL, REPEAT_LABEL, SOFT } from '../theme';

export type Draft = TimedTaskInput & { id: string | null };

interface Props {
  draft: Draft;
  isWide: boolean;
  onClose: () => void;
  onSave: (d: Draft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  flash: (m: string) => void;
}

export function TaskSheet({ draft, isWide, onClose, onSave, onDelete, flash }: Props) {
  const [s, setS] = useState(draft);
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<Draft>) => setS((x) => ({ ...x, ...p }));
  const color = COLORS[s.color];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!s.title.trim()) return flash('Give your task a name');
    run(() => onSave({ ...s, title: s.title.trim() }));
  };

  return (
    <div className="scrim" onClick={onClose} style={{ alignItems: isWide ? 'center' : 'flex-end' }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={s.id ? 'Edit task' : 'New task'} onClick={(e) => e.stopPropagation()} style={{ borderRadius: isWide ? 24 : '24px 24px 0 0', paddingBottom: isWide ? 24 : 'calc(24px + env(safe-area-inset-bottom))' }}>
        <div className="sheet-head">
          <div className="sheet-title">{s.id ? 'Edit task' : 'New task'}</div>
          <button className="sheet-close" onClick={onClose} aria-label="Close"><span className="ms">close</span></button>
        </div>
        <div className="sheet-name">
          <div className="sheet-swatch" style={{ background: color }}><span className="ms">{s.icon}</span></div>
          <input value={s.title} onChange={(e) => up({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="What are you doing?" maxLength={200} autoFocus={!s.id} />
        </div>
        <div className="icon-row" role="radiogroup" aria-label="Icon">
          {ICONS.map((i) => (
            <button key={i} role="radio" aria-checked={s.icon === i} aria-label={i.replace(/_/g, ' ')} onClick={() => up({ icon: i })} style={{ background: s.icon === i ? color : SOFT, color: s.icon === i ? '#fff' : LABEL }}>
              <span className="ms">{i}</span>
            </button>
          ))}
        </div>
        <div className="sheet-grid">
          <label className="field">Date<input type="date" value={s.date} onChange={(e) => e.target.value && up({ date: e.target.value })} /></label>
          <label className="field">Start<input type="time" value={s.start} onChange={(e) => e.target.value && up({ start: e.target.value })} /></label>
        </div>
        <div className="sheet-section">
          <div className="sheet-label">How long?</div>
          <div className="chips">
            {DURATIONS.map((m) => (
              <button key={m} aria-pressed={s.dur === m} onClick={() => up({ dur: m })} style={{ background: s.dur === m ? color : SOFT, color: s.dur === m ? '#fff' : INK }}>{fmtD(m)}</button>
            ))}
          </div>
        </div>
        <div className="sheet-section">
          <div className="sheet-label">Color</div>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c, i) => (
              <button key={c} role="radio" aria-checked={s.color === i} aria-label={`Color ${i + 1}`} onClick={() => up({ color: i })} style={{ background: c, boxShadow: s.color === i ? `0 0 0 3px #fff, 0 0 0 5px ${c}` : 'none' }} />
            ))}
          </div>
        </div>
        <div className="sheet-section">
          <div className="sheet-label">Repeat</div>
          <div className="seg repeat-seg">
            {REPEATS.map((k) => (
              <button key={k} className={s.repeat === k ? 'on' : ''} onClick={() => up({ repeat: k })}>{k === 'none' ? 'Once' : REPEAT_LABEL[k]}</button>
            ))}
          </div>
        </div>
        <div className="sheet-actions">
          {s.id && <button className="danger" disabled={busy} onClick={() => run(() => onDelete(s.id!))}>Delete</button>}
          <button className="save" disabled={busy} onClick={save}>{s.id ? 'Save changes' : 'Create task'}</button>
        </div>
      </div>
    </div>
  );
}
