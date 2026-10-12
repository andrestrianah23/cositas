import { useState } from 'react';
import { api } from '../api';
import { MORNING_LEAD_MIN, type NotifyPrefs, type User } from '../../shared/types';

interface Props {
  me: User;
  onUser: (u: User) => void;
  flash: (m: string) => void;
  /** Whether this device receives notifications; the choices apply either way. */
  pushOn: boolean;
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/** Which notifications LockedIn sends: task reminders, morning briefing, evening check-in, Sunday review. */
export function PrefsCard({ me, onUser, flash, pushOn }: Props) {
  const [p, setP] = useState(me.prefs);

  const save = async (patch: Partial<NotifyPrefs>) => {
    const before = p;
    setP({ ...p, ...patch });
    try {
      onUser((await api.savePrefs(patch)).user);
    } catch (e) {
      setP(before);
      flash((e as Error).message);
    }
  };

  const morningMode = p.morning === 'off' ? 'off' : p.morning === 'auto' ? 'auto' : 'time';

  return (
    <div className="card profile">
      <div>
        <div className="card-title">What to send</div>
        <div className="install-sub">{pushOn ? 'Choose which reminders LockedIn sends you.' : 'These apply once reminders are turned on above.'}</div>
      </div>
      <div className="prefs">
        <div className="pref">
          <span className="ms">alarm</span>
          <div className="pref-text"><strong>Task reminders</strong><span>When each task starts, or earlier. Set the timing on each task.</span></div>
          <Switch on={p.tasks} label="Task reminders" onChange={(v) => save({ tasks: v })} />
        </div>
        <div className="pref">
          <span className="ms">wb_sunny</span>
          <div className="pref-text"><strong>Morning briefing</strong><span>Your day at a glance and your best streak.</span>
          <div className="pref-controls">
            <select className="pref-select" aria-label="Morning briefing" value={morningMode} onChange={(e) => save({ morning: e.target.value === 'time' ? '07:00' : e.target.value })}>
              <option value="auto">{MORNING_LEAD_MIN} min before first task</option>
              <option value="time">At a set time</option>
              <option value="off">Off</option>
            </select>
            {morningMode === 'time' && <input className="pref-time" type="time" aria-label="Morning briefing time" value={p.morning} onChange={(e) => e.target.value && save({ morning: e.target.value })} />}
          </div>
          </div>
        </div>
        <div className="pref">
          <span className="ms">event_repeat</span>
          <div className="pref-text"><strong>Evening check-in</strong><span>Two hours after your last task, only if something is unticked. Once a day at most.</span></div>
          <Switch on={p.checkin} label="Evening check-in" onChange={(v) => save({ checkin: v })} />
        </div>
        <div className="pref">
          <span className="ms">insights</span>
          <div className="pref-text"><strong>Sunday weekly review</strong><span>What you got done, goals hit, and your best streak.</span>
            {p.review !== 'off' && (
              <div className="pref-controls"><label className="pref-at">Sundays at <input className="pref-time" type="time" aria-label="Weekly review time" value={p.review} onChange={(e) => e.target.value && save({ review: e.target.value })} /></label></div>
            )}
          </div>
          <Switch on={p.review !== 'off'} label="Sunday weekly review" onChange={(v) => save({ review: v ? '19:00' : 'off' })} />
        </div>
      </div>
    </div>
  );
}
