import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * - unsupported: this browser can't receive push at all
 * - needs-install: iPhone/iPad Safari, where push only works once the app is on the home screen
 * - default: never asked · denied: blocked in browser settings
 * - off: allowed, but this device isn't subscribed · on: reminders arrive on this device
 */
export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'off' | 'on';
/** prompt: one-tap install · ios: Share → Add to Home Screen · manual: browser menu */
export type InstallMethod = 'prompt' | 'ios' | 'manual';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const pushCapable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

async function currentSubscription() {
  if (!pushCapable()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function readPushState(): Promise<PushState> {
  // iOS only delivers web push to apps opened from the home screen.
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!pushCapable()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Stops reminders on this device, e.g. before signing out so the next person doesn't get them. */
export async function forgetDevice() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch {
    // Nothing to clean up.
  }
}

export function usePwa(signedIn: boolean) {
  const [installEvt, setInstallEvt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [push, setPush] = useState<PushState>('unsupported');

  const refresh = useCallback(async () => setPush(await readPushState()), []);

  useEffect(() => {
    const bip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setInstallEvt(null);
    };
    window.addEventListener('beforeinstallprompt', bip);
    window.addEventListener('appinstalled', done);
    refresh();
    return () => {
      window.removeEventListener('beforeinstallprompt', bip);
      window.removeEventListener('appinstalled', done);
    };
  }, [refresh]);

  // Keep the server's copy of this device current (time zone, who is signed in).
  useEffect(() => {
    if (!signedIn) return;
    currentSubscription()
      .then((sub) => sub && api.pushSubscribe(sub.toJSON(), timeZone()))
      .catch(() => {});
  }, [signedIn]);

  const install = useCallback(async () => {
    if (!installEvt) return false;
    await installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    setInstallEvt(null);
    if (outcome === 'accepted') setInstalled(true);
    return outcome === 'accepted';
  }, [installEvt]);

  /** Asks for permission (must run from a tap) and subscribes this device. */
  const enablePush = useCallback(async (): Promise<{ on: boolean; error?: string }> => {
    if (!pushCapable()) return { on: false, error: 'This browser can’t show notifications.' };
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      await refresh();
      return { on: false, error: perm === 'denied' ? 'Notifications are blocked. You can allow them in your browser settings.' : undefined };
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api.pushKey();
      // subscribe() can hang when the browser's push service is unreachable; don't leave the button spinning.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Couldn’t reach the notification service. Check your connection and try again.')), 20_000),
      );
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), timeout]));
      await api.pushSubscribe(sub.toJSON(), timeZone());
      await refresh();
      return { on: true };
    } catch (e) {
      await refresh();
      return { on: false, error: (e as Error).message || 'Couldn’t turn on reminders.' };
    }
  }, [refresh]);

  const disablePush = useCallback(async () => {
    await forgetDevice();
    await refresh();
  }, [refresh]);

  const method: InstallMethod = installEvt ? 'prompt' : isIOS() ? 'ios' : 'manual';
  return { installed, method, install, push, enablePush, disablePush };
}

export type Pwa = ReturnType<typeof usePwa>;

const SNOOZE_DAYS = 7;
export function snoozed(key: string) {
  try {
    return Date.now() - Number(localStorage.getItem(`lockedin.snooze.${key}`) || 0) < SNOOZE_DAYS * 864e5;
  } catch {
    return false;
  }
}
export function snooze(key: string) {
  try {
    localStorage.setItem(`lockedin.snooze.${key}`, String(Date.now()));
  } catch {
    // Storage unavailable: the card will simply show again next visit.
  }
}
