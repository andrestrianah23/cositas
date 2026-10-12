import { useState, type FormEvent } from 'react';
import { api } from '../api';

/** Settings card: change the password, which signs out every other device. */
export function PasswordCard({ email, flash }: { email: string; flash: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setErr('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 6) return setErr('New password must be at least 6 characters.');
    if (next !== confirm) return setErr('The new passwords don’t match.');
    if (next === current) return setErr('Choose a password different from your current one.');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      close();
      flash('Password changed');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="card install">
        <div className="install-text">
          <div className="card-title">Password</div>
          <div className="install-sub">Change the password you sign in with.</div>
        </div>
        <button className="btn-outline" onClick={() => setOpen(true)}><span className="ms inline">lock</span> Change password</button>
      </div>
    );
  }

  return (
    <form className="card profile" onSubmit={submit} noValidate>
      <div className="card-title">Change password</div>
      {/* Lets password managers update the saved entry for this account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <label className="field">Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={72} autoFocus /></label>
      <label className="field">New password<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" maxLength={72} /></label>
      <label className="field">Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={72} /></label>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="profile-note">Other devices will be signed out. You’ll stay signed in here.</div>
      <div className="reminder-actions">
        <button type="submit" className="btn-accent" disabled={busy}>Save new password</button>
        <button type="button" className="btn-outline" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}
