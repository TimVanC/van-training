import { supabase } from './supabaseClient';

/**
 * Browser-side Web Push plumbing: permission, service-worker subscription, and
 * mirroring the subscription into Supabase so the server can send to it.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type EnablePushResult = 'subscribed' | 'denied' | 'unsupported' | 'error';

/** True when running as a home-screen app (iOS "Add to Home Screen" / installed PWA). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS reports itself as a Mac but has touch.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** iOS only exposes PushManager to installed home-screen apps, so this doubles as the install check there. */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    typeof VAPID_PUBLIC_KEY === 'string' &&
    VAPID_PUBLIC_KEY.length > 0
  );
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await getRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function storeSubscription(userId: string, subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return false;
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 255),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  return !error;
}

/**
 * Asks for permission (must be called from a tap), subscribes this device,
 * and records the subscription for the signed-in user.
 */
export async function enablePush(userId: string): Promise<EnablePushResult> {
  if (!isPushSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const registration = await getRegistration();
    if (!registration) return 'error';
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string),
      }));
    return (await storeSubscription(userId, subscription)) ? 'subscribed' : 'error';
  } catch {
    return 'error';
  }
}

/** Removes this device's subscription both from the browser and from Supabase. */
export async function disablePush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    /* Already gone; still remove our record. */
  }
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
