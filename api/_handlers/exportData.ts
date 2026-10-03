import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate } from '../_lib/auth.js';

async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

async function ownRows(supabase: SupabaseClient, table: string, columns: string, userId: string): Promise<unknown[]> {
  return fetchAllPages((from, to) => supabase.from(table).select(columns).eq('user_id', userId).range(from, to));
}

/**
 * Everything the app holds about the caller, as one JSON document: programs,
 * every logged session and set, imported history, check-ins and reminder
 * settings. Read-only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const auth = await authenticate(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const { supabase, userId } = auth;

    const [splits, sessions, history, checkins, notificationSettings] = await Promise.all([
      ownRows(
        supabase,
        'splits',
        'name, created_at, workouts ( name, order_index, workout_exercises ( order_index, sets, rep_range, exercises ( name ) ) )',
        userId,
      ),
      ownRows(
        supabase,
        'sessions',
        'date, notes, workouts ( name, splits ( name ) ), lift_sets ( exercise_name, set_number, weight, reps, rir, plate_data )',
        userId,
      ),
      ownRows(
        supabase,
        'historical_lift_sets',
        'date, date_estimated, split_name, exercise_name, weight, reps, is_drop_set',
        userId,
      ),
      ownRows(supabase, 'workout_checkins', '*', userId),
      ownRows(supabase, 'notification_settings', '*', userId),
    ]);

    res.status(200).json({
      exportedAt: new Date().toISOString(),
      units: 'lb',
      splits,
      sessions,
      importedHistory: history,
      checkins,
      notificationSettings,
    });
  } catch (error) {
    console.error('Error in exportData:', error);
    res.status(500).json({ error: "Couldn't build your export. Try again." });
  }
}
