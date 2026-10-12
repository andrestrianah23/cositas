import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Pwa } from '../pwa';
import { PasswordCard } from './PasswordCard';
import { PrefsCard } from './PrefsCard';
import type { User } from '../../shared/types';

interface Props {
  me: User;
  onUser: (u: User) => void;
  flash: (m: string) => void;
  pwa: Pwa;
  replayTour: () => void;
  signOut: () => void;
}

const PUSH_TEXT: Record<Pwa['push'], string> = {
  on: 'On for this device. You’ll get a notification when each task starts.',
  off: 'Off for this device.',
  default: 'Get a notification the moment each task starts, even when LockedIn is closed.',
  denied: 'Notifications are blocked for LockedIn. Allow them in your browser or phone settings (Site settings → Notifications), then come back here.',
  'needs-install': 'On iPhone and iPad, reminders work once LockedIn is on your home screen. Install it first (see above), then open it from the home screen.',
  unsupported: 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.',
};

export function SettingsView({ me, onUser, flash, pwa, replayTour, signOut }: Props) {
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = async (v: string) => {
    clearTimeout(timer.current);
    const trimmed = v.trim();
    if (!trimmed || trimmed === me.name) return;
    try {
      onUser((await api.rename(trimmed)).user);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // Save shortly after typing stops, like the prototype's live name field.
  const change = (v: string) => {
    setName(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 600);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const installText = pwa.installed
    ? 'LockedIn is installed on this device.'
    : pwa.method === 'prompt'
      ? 'Add LockedIn to your home screen for one-tap access and reminders.'
      : pwa.method === 'ios'
        ? 'In Safari, tap Share, then “Add to Home Screen”.'
        : 'Use your browser’s “Install app” or “Add to Home Screen” option to keep LockedIn one tap away.';

  return (
    <div className="settings">
      <div className="card profile">
        <div className="card-title">Profile</div>
        <label className="field">
          Name
          <input value={name} onChange={(e) => change(e.target.value)} onBlur={() => save(name)} maxLength={80} autoComplete="name" />
        </label>
        <div className="profile-note">Signed in as <strong>{me.email}</strong> · {me.role === 'admin' ? 'Administrator' : 'Free plan'}</div>
      </div>
      <PasswordCard email={me.email} flash={flash} />
      <div className="card install">
        <div className="install-text">
          <div className="card-title">Install LockedIn</div>
          <div className="install-sub">{installText}</div>
        </div>
        {!pwa.installed && pwa.method === 'prompt' && (
          <button className="btn-accent" onClick={async () => { if (await pwa.install()) flash('LockedIn installed'); }}>Install app</button>
        )}
      </div>
      <div className="card install">
        <div className="install-text">
          <div className="card-title">Reminders</div>
          <div className="install-sub">{PUSH_TEXT[pwa.push]}</div>
        </div>
        {(pwa.push === 'default' || pwa.push === 'off') && (
          <button
            className="btn-accent"
            disabled={busy}
            onClick={() => run(async () => {
              const r = await pwa.enablePush();
              if (r.on) flash('Reminders are on');
              else if (r.error) flash(r.error);
            })}
          >
            Turn on
          </button>
        )}
        {pwa.push === 'on' && (
          <div className="reminder-actions">
            <button className="btn-outline" disabled={busy} onClick={() => run(async () => {
              try {
                await api.pushTest();
                flash('Test notification sent');
              } catch (e) {
                flash((e as Error).message);
              }
            })}>Send a test</button>
            <button className="btn-outline" disabled={busy} onClick={() => run(async () => { await pwa.disablePush(); flash('Reminders are off'); })}>Turn off</button>
          </div>
        )}
      </div>
      <PrefsCard me={me} onUser={onUser} flash={flash} pushOn={pwa.push === 'on'} />
      <div className="card install">
        <div className="install-text">
          <div className="card-title">Tutorial</div>
          <div className="install-sub">A one-minute walk through every tool in LockedIn.</div>
        </div>
        <button className="btn-outline" onClick={replayTour}><span className="ms inline">school</span> Replay tutorial</button>
      </div>
      <button className="btn-signout" onClick={signOut}><span className="ms">logout</span>Sign out</button>
    </div>
  );
}
