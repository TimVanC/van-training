import webpush, { type PushSubscription } from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReminderMessage } from '../../src/lib/reminders.js';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;

/** Reads VAPID env vars once; throws a clear error if they are missing. */
export function configureWebPush(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:timvancau@gmail.com';
  if (!publicKey || !privateKey) {
    throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Subscriptions the push service reported as gone; already deleted. */
  removed: number;
}

/**
 * Sends one message to every subscription, pruning ones the push service says
 * no longer exist (404/410 — the user cleared site data or removed the app).
 */
export async function sendToSubscriptions(
  supabase: SupabaseClient,
  subscriptions: SubscriptionRow[],
  message: ReminderMessage,
): Promise<SendResult> {
  configureWebPush();
  const payload = JSON.stringify(message);
  const result: SendResult = { sent: 0, failed: 0, removed: 0 };
  const gone: string[] = [];

  await Promise.all(
    subscriptions.map(async (row) => {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
        result.sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone.push(row.id);
          result.removed += 1;
        } else {
          result.failed += 1;
          console.error('push send failed', row.endpoint.slice(0, 48), status, error);
        }
      }
    }),
  );

  if (gone.length > 0) {
    const { error } = await supabase.from('push_subscriptions').delete().in('id', gone);
    if (error) console.error('failed to prune dead push subscriptions', error);
  }
  return result;
}
