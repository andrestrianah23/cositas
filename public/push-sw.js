// Loaded into the generated service worker (see workbox.importScripts in vite.config.ts).
const ICON = '/app-icon-192.png';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LockedIn', {
      body: data.body || '',
      icon: ICON,
      badge: ICON,
      tag: data.tag,
      // Task reminders carry Done / Remind-me buttons (Android and desktop; iOS shows the reminder without them).
      actions: Array.isArray(data.actions) ? data.actions : [],
      data: { url: data.url || '/', taskId: data.taskId, day: data.day },
    }),
  );
});

/** Lets an open app window pick up a change made from a notification. */
async function tellClients(message) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  wins.forEach((w) => w.postMessage(message));
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const unit = { daily: 'day', weekly: 'week', monthly: 'month' };

async function markDone(n) {
  const { taskId, day } = n.data;
  try {
    const { task, streak } = await post(`/api/tasks/${taskId}/done`, { key: day });
    await tellClients({ type: 'refresh' });
    const u = unit[task.repeat];
    // Replaces the reminder quietly (same tag): a small "nice one" instead of a new alert.
    await self.registration.showNotification(`${task.title} ✓`, {
      body: streak >= 2 && u ? `${streak} ${u}s in a row. Keep it going!` : 'Ticked off. Nice work!',
      icon: ICON,
      badge: ICON,
      tag: n.tag,
      silent: true,
      data: { url: n.data.url },
    });
  } catch {
    await self.registration.showNotification('Couldn’t tick it off', {
      body: 'Open LockedIn to tick it off there.',
      icon: ICON,
      tag: n.tag,
      data: { url: n.data.url },
    });
  }
}

async function snooze(n) {
  const { taskId, day } = n.data;
  try {
    await post('/api/push/snooze', { taskId, day });
  } catch {
    await self.registration.showNotification('Couldn’t snooze that reminder', {
      body: 'Open LockedIn to check your day.',
      icon: ICON,
      tag: n.tag,
      data: { url: n.data.url },
    });
  }
}

async function openApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
  if (!open) return self.clients.openWindow(url);
  // The app is already open: tell it which day (or screen) to show.
  open.postMessage({ type: 'open', url });
  return open.focus();
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  if (event.action === 'done' && n.data && n.data.taskId) return event.waitUntil(markDone(n));
  if (event.action === 'snooze' && n.data && n.data.taskId) return event.waitUntil(snooze(n));
  event.waitUntil(openApp((n.data && n.data.url) || '/'));
});
