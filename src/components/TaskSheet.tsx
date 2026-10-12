import { useEffect, useState } from 'react';
import { fmtD, pad, toMin } from '../../shared/dates';
import { ICONS, REMIND_OPTIONS, REPEATS, type TimedTaskInput } from '../../shared/types';
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

const DAY = 1440;
const toHM = (m: number) => `${pad(Math.floor((m % DAY) / 60))}:${pad(m % 60)}`;
const TOO_EARLY = 'End time must be after the start time, on the same day. For something that runs past midnight, add a second task for the next day.';

export function TaskSheet({ draft, isWide, onClose, onSave, onDelete, flash }: Props) {
  // Older tasks could run past midnight; editing one trims it to end at midnight.
  const [s, setS] = useState(() => ({ ...draft, dur: Math.min(draft.dur, DAY - toMin(draft.start)) }));
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<Draft>) => setS((x) => ({ ...x, ...p }));
  const color = COLORS[s.color];
  // Tasks stay within one day: the end is at most midnight (shown as 12:00 AM).
  const end = toHM(Math.min(toMin(s.start) + s.dur, DAY));
  const setStart = (v: string) => {
    const start = toMin(v);
    // Keep the length when the start moves, but never past midnight.
    up({ start: v, dur: s.dur > 0 ? Math.min(s.dur, DAY - start) : s.dur });
  };
  const setEnd = (v: string) => {
    const endMin = toMin(v) === 0 ? DAY : toMin(v);
    up({ dur: endMin - toMin(s.start) });
  };

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
    if (s.dur < 1) return flash(TOO_EARLY);
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
        <label className="field">Date<input type="date" value={s.date} onChange={(e) => e.target.value && up({ date: e.target.value })} /></label>
        <div className="sheet-times">
          <div className="sheet-grid">
            {/* Moving the start keeps the length; the end follows. */}
            <label className="field">Start<input type="time" value={s.start} onChange={(e) => e.target.value && setStart(e.target.value)} /></label>
            <label className="field">End<input type="time" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} /></label>
          </div>
          <div className={`sheet-length${s.dur < 1 ? ' bad' : ''}`}>
            <span className="ms">schedule</span>
            {s.dur < 1 ? TOO_EARLY : `${fmtD(s.dur)}${toMin(s.start) + s.dur === DAY ? ' · ends at midnight' : ''}`}
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
          <div className="sheet-label">Remind me</div>
          <div className="chips" role="radiogroup" aria-label="Remind me">
            {REMIND_OPTIONS.map((m) => (
              <button key={m} role="radio" aria-checked={s.remind === m} onClick={() => up({ remind: m })} style={{ background: s.remind === m ? color : SOFT, color: s.remind === m ? '#fff' : INK }}>
                {m === -1 ? 'Off' : m === 0 ? 'At the start' : `${fmtD(m)} before`}
              </button>
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
