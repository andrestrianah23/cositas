import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { User } from '../../shared/types';

interface Props {
  me: User;
  onUser: (u: User) => void;
  flash: (m: string) => void;
  canInstall: boolean;
  install: () => void;
  signOut: () => void;
}

export function SettingsView({ me, onUser, flash, canInstall, install, signOut }: Props) {
  const [name, setName] = useState(me.name);
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
      <div className="card install">
        <div className="install-text">
          <div className="card-title">Install Lockedin</div>
          <div className="install-sub">
            {canInstall ? 'Add Lockedin to your home screen for one-tap access.' : 'Use your browser’s “Add to Home Screen” or install option to keep Lockedin one tap away.'}
          </div>
        </div>
        {canInstall && <button className="btn-accent" onClick={install}>Install app</button>}
      </div>
      <button className="btn-signout" onClick={signOut}><span className="ms">logout</span>Sign out</button>
    </div>
  );
}
