import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { computeUpNext, testMessage, type UpNextSession, type UpNextSplit } from '../src/lib/reminders.js';
import { sendToSubscriptions, type SubscriptionRow } from './_lib/push.js';

interface SessionQueryRow {
  date: string;
  workouts:
    | { name: string; splits: { name: string } | { name: string }[] | null }
    | Array<{ name: string; splits: { name: string } | { name: string }[] | null }>
    | null;
}

function unwrap<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Sends a test push to every device the signed-in user has subscribed. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization token' });
      return;
    }
    const authResult = await supabase.auth.getUser(token);
    if (authResult.error || !authResult.data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    const userId = authResult.data.user.id;

    const [subsResult, sessionsResult, splitsResult] = await Promise.all([
      supabase.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').eq('user_id', userId),
      supabase
        .from('sessions')
        .select('date, workouts(name, splits(name))')
        .eq('user_id', userId)
        .order('date', { ascending: true }),
      supabase.from('splits').select('name, workouts(name, order_index)').eq('user_id', userId),
    ]);
    if (subsResult.error) throw subsResult.error;
    if (sessionsResult.error) throw sessionsResult.error;
    if (splitsResult.error) throw splitsResult.error;

    const subscriptions = (subsResult.data ?? []) as SubscriptionRow[];
    if (subscriptions.length === 0) {
      res.status(400).json({ error: 'No subscribed devices. Turn on reminders first.' });
      return;
    }

    const sessions: UpNextSession[] = ((sessionsResult.data ?? []) as SessionQueryRow[]).map((s) => {
      const workout = unwrap(s.workouts);
      const split = workout ? unwrap(workout.splits) : null;
      return { date: s.date, dayName: workout?.name ?? 'Workout', splitName: split?.name ?? '' };
    });
    const splits = (splitsResult.data ?? []) as Array<{ name: string; workouts: UpNextSplit['workouts'] | null }>;
    const upNext = computeUpNext(
      sessions,
      splits.map((s) => ({ name: s.name, workouts: s.workouts ?? [] })),
    );

    const result = await sendToSubscriptions(supabase, subscriptions, testMessage(upNext));
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in sendTestNotification:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
