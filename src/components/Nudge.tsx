import { useState } from 'react';
import { snooze, snoozed, type Pwa } from '../pwa';

/** One card at a time: first get the app installed, then get reminders turned on. */
export function Nudge({ pwa, flash }: { pwa: Pwa; flash: (m: string) => void }) {
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState(false);
  const later = (key: string) => {
    snooze(key);
    rerender((n) => n + 1);
  };

  if (!pwa.installed && !snoozed('install')) {
    return (
      <div className="card nudge" role="region" aria-label="Install LockedIn">
        <div className="nudge-icon"><span className="ms">install_mobile</span></div>
        <div className="nudge-body">
          <div className="nudge-title">Get LockedIn on your home screen</div>
          {pwa.method === 'ios' ? (
            <ol className="nudge-steps">
              <li>Tap <span className="ms inline">ios_share</span> <strong>Share</strong> in Safari’s toolbar.</li>
              <li>Choose <span className="ms inline">add_box</span> <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
              <li>Open LockedIn from your home screen to turn on reminders.</li>
            </ol>
          ) : (
            <div className="nudge-text">
              {pwa.method === 'prompt'
                ? 'One tap to open your plan like an app, full screen, with reminders when each task starts.'
                : 'Open your browser menu and choose “Install app” or “Add to Home Screen” to keep LockedIn one tap away.'}
            </div>
          )}
          <div className="nudge-actions">
            {pwa.method === 'prompt' && (
              <button className="btn-accent" onClick={async () => { if (await pwa.install()) flash('LockedIn installed'); }}>Install app</button>
            )}
            <button className="nudge-later" onClick={() => later('install')}>{pwa.method === 'prompt' ? 'Not now' : 'Got it'}</button>
          </div>
        </div>
      </div>
    );
  }

  if ((pwa.push === 'default' || pwa.push === 'off') && !snoozed('push')) {
    return (
      <div className="card nudge" role="region" aria-label="Turn on reminders">
        <div className="nudge-icon"><span className="ms">notifications_active</span></div>
        <div className="nudge-body">
          <div className="nudge-title">Never miss a start time</div>
          <div className="nudge-text">Turn on reminders and LockedIn will notify you the moment each task begins, even when the app is closed.</div>
          <div className="nudge-actions">
            <button
              className="btn-accent"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await pwa.enablePush();
                setBusy(false);
                if (r.on) flash('Reminders are on');
                else if (r.error) flash(r.error);
              }}
            >
              Turn on reminders
            </button>
            <button className="nudge-later" onClick={() => later('push')}>Not now</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
