import { useState } from 'react';
import { api } from '../api';

interface Props {
  /** Send to one customer; omit to send to every customer with reminders on. */
  userId?: string;
  audience: string;
  flash: (m: string) => void;
}

export function NotifyForm({ userId, audience, flash }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title.trim() || !body.trim()) return flash('Add a title and a message');
    if (!userId && !confirm(`Send “${title.trim()}” to ${audience}?`)) return;
    setBusy(true);
    try {
      const r = await api.adminNotify(title.trim(), body.trim(), userId);
      flash(userId ? 'Notification sent' : `Sent to ${r.people} ${r.people === 1 ? 'person' : 'people'} (${r.devices} ${r.devices === 1 ? 'device' : 'devices'})`);
      setTitle('');
      setBody('');
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notify-form">
      <label className="field">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. New this week" />
      </label>
      <label className="field">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} rows={3} placeholder="What do you want to tell them?" />
      </label>
      <div className="notify-foot">
        <span className="notify-audience"><span className="ms">campaign</span>To {audience}</span>
        <button className="btn-accent" disabled={busy} onClick={send}><span className="ms">send</span>Send</button>
      </div>
    </div>
  );
}
