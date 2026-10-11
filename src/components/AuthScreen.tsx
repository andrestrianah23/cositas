import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { COLORS } from '../theme';
import type { User } from '../../shared/types';

const HERO = [
  { icon: 'alarm', time: '7:00 AM', title: 'Wake up', h: 52, color: COLORS[0] },
  { icon: 'self_improvement', time: '7:15 AM · 30m', title: 'Yoga', h: 84, color: COLORS[1] },
  { icon: 'work', time: '9:00 AM · 2h', title: 'Deep work', h: 120, color: COLORS[2] },
];

interface Props {
  isWide: boolean;
  demo: boolean;
  initialMode?: 'signin' | 'signup';
  /** Returns to the landing page; omitted inside the installed app, which has no landing page. */
  onBack?: () => void;
  onAuthed: (u: User, isNew: boolean) => void;
}

export function AuthScreen({ isWide, demo, initialMode = 'signin', onBack, onAuthed }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = mode === 'signup';

  const switchTo = (m: typeof mode) => {
    setMode(m);
    setErr('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (up) {
      if (!name.trim()) return setErr('Please enter your name.');
      if (!/^\S+@\S+\.\S+$/.test(em)) return setErr('Please enter a valid email.');
      if (password.length < 6) return setErr('Password must be at least 6 characters.');
    }
    setBusy(true);
    try {
      const { user } = up ? await api.signUp(name.trim(), em, password) : await api.signIn(em, password);
      onAuthed(user, up);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      {isWide && (
        <div className="auth-hero">
          <div className="brand">
            <img src="/logo-mark.png" alt="LockedIn" width={40} height={40} style={{ borderRadius: 11 }} />
            <div className="brand-name" style={{ fontSize: 22 }}>LockedIn</div>
          </div>
          <div className="hero-list">
            {HERO.map((r, i) => (
              <div key={r.title} style={{ display: 'contents' }}>
                {i > 0 && <div className="hero-line" />}
                <div className="hero-row">
                  <div className="hero-tile" style={{ height: r.h, background: r.color }}>
                    <span className="ms">{r.icon}</span>
                  </div>
                  <div>
                    <div className="hero-time mono">{r.time}</div>
                    <div className="hero-title">{r.title}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hero-tag">Plan the day, the week and the month in one place.</div>
        </div>
      )}
      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          {onBack && (
            <button type="button" className="back" onClick={onBack}><span className="ms">arrow_back</span>Back to home</button>
          )}
          {!isWide && (
            <div className="brand" style={{ marginBottom: 12 }}>
              <img src="/logo-mark.png" alt="LockedIn" width={44} height={44} style={{ borderRadius: 12 }} />
              <div className="brand-name" style={{ fontSize: 24 }}>LockedIn</div>
            </div>
          )}
          <div>
            <div className="auth-title">{up ? 'Create your account' : 'Welcome back'}</div>
            <div className="auth-sub">{up ? 'Free forever. No card needed.' : 'Sign in to pick up where you left off.'}</div>
          </div>
          <div className="seg">
            <button type="button" className={up ? '' : 'on'} onClick={() => switchTo('signin')}>Sign in</button>
            <button type="button" className={up ? 'on' : ''} onClick={() => switchTo('signup')}>Create free account</button>
          </div>
          <div className="auth-fields">
            {up && (
              <label className="field">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" maxLength={80} />
              </label>
            )}
            <label className="field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            <label className="field">
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete={up ? 'new-password' : 'current-password'} maxLength={72} />
            </label>
          </div>
          {err && <div className="error" role="alert">{err}</div>}
          <button type="submit" className="btn-dark" disabled={busy}>{up ? 'Create free account' : 'Sign in'}</button>
          <div className="auth-foot">
            {demo ? (
              <>
                Demo accounts — admin: <span className="mono">admin@lockedin.app / admin123</span> · user: <span className="mono">maya@example.com / maya123</span>
              </>
            ) : (
              'Your plans sync to every device you sign in on.'
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
