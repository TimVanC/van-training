import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  computeUpNext,
  eveningMessage,
  localTimeIn,
  morningMessage,
  reminderDue,
  type ReminderKind,
  type ReminderSettings,
  type UpNextSession,
  type UpNextSplit,
} from '../src/lib/reminders.js';
import { sendToSubscriptions, type SubscriptionRow } from './_lib/push.js';

/**
 * Cron target (Supabase pg_cron hits this every 10 minutes with the
 * CRON_SECRET bearer token). Sends each opted-in user their morning and
 * evening workout reminders at the right local time, at most once a day each.
 */

interface SettingsRow {
  user_id: string;
  enabled: boolean;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  days: number[] | null;
  timezone: string | null;
  last_morning_sent_on: string | null;
  last_evening_sent_on: string | null;
}

interface SessionQueryRow {
  date: string;
  workouts:
    | { name: string; splits: { name: string } | { name: string }[] | null }
    | Array<{ name: string; splits: { name: string } | { name: string }[] | null }>
    | null;
}

interface SplitQueryRow {
  name: string;
  workouts: Array<{ name: string; order_index: number }> | null;
}

function unwrap<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toSettings(row: SettingsRow): ReminderSettings {
  return {
    enabled: row.enabled,
    morningEnabled: row.morning_enabled,
    morningTime: row.morning_time,
    eveningEnabled: row.evening_enabled,
    eveningTime: row.evening_time,
    days: row.days ?? [0, 1, 2, 3, 4, 5, 6],
    timezone: row.timezone ?? 'America/New_York',
    lastMorningSentOn: row.last_morning_sent_on,
    lastEveningSentOn: row.last_evening_sent_on,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date();

    const { data: settingsRows, error: settingsError } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('enabled', true);
    if (settingsError) throw settingsError;

    const summary: Array<{ userId: string; kind: ReminderKind; sent: number; skipped?: string }> = [];

    for (const row of (settingsRows ?? []) as SettingsRow[]) {
      const settings = toSettings(row);
      const local = localTimeIn(now, settings.timezone);
      const due = (['morning', 'evening'] as const).filter((kind) => reminderDue(kind, settings, local));
      if (due.length === 0) continue;

      const [sessionsResult, splitsResult, subsResult] = await Promise.all([
        supabase
          .from('sessions')
          .select('date, workouts(name, splits(name))')
          .eq('user_id', row.user_id)
          .order('date', { ascending: true }),
        supabase.from('splits').select('name, workouts(name, order_index)').eq('user_id', row.user_id),
        supabase
          .from('push_subscriptions')
          .select('id, user_id, endpoint, p256dh, auth')
          .eq('user_id', row.user_id),
      ]);
      if (sessionsResult.error) throw sessionsResult.error;
      if (splitsResult.error) throw splitsResult.error;
      if (subsResult.error) throw subsResult.error;

      const sessions: UpNextSession[] = ((sessionsResult.data ?? []) as SessionQueryRow[]).map((s) => {
        const workout = unwrap(s.workouts);
        const split = workout ? unwrap(workout.splits) : null;
        return { date: s.date, dayName: workout?.name ?? 'Workout', splitName: split?.name ?? '' };
      });
      const splits = (splitsResult.data ?? []) as SplitQueryRow[];
      const upNext = computeUpNext(
        sessions,
        splits.map((s): UpNextSplit => ({ name: s.name, workouts: s.workouts ?? [] })),
      );
      const trainedToday = sessions.some(
        (s) => localTimeIn(new Date(s.date), settings.timezone).dateKey === local.dateKey,
      );
      const subscriptions = (subsResult.data ?? []) as SubscriptionRow[];

      for (const kind of due) {
        const column = kind === 'morning' ? 'last_morning_sent_on' : 'last_evening_sent_on';
        let sent = 0;
        let skipped: string | undefined;
        if (trainedToday) {
          skipped = 'already trained today';
        } else if (subscriptions.length === 0) {
          skipped = 'no subscriptions';
        } else {
          const message = kind === 'morning' ? morningMessage(upNext) : eveningMessage(upNext);
          const result = await sendToSubscriptions(supabase, subscriptions, message);
          sent = result.sent;
        }
        // Mark the day as handled either way so a skipped reminder doesn't
        // retry on every tick for the rest of the window.
        const { error: updateError } = await supabase
          .from('notification_settings')
          .update({ [column]: local.dateKey })
          .eq('user_id', row.user_id);
        if (updateError) throw updateError;
        summary.push({ userId: row.user_id, kind, sent, skipped });
      }
    }

    res.status(200).json({ checked: settingsRows?.length ?? 0, reminders: summary });
  } catch (error) {
    console.error('Error in sendReminders:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
