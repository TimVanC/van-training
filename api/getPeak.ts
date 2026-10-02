import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { computePeakReport, splitAbbreviation, type PeakSetRow } from '../src/lib/peak.js';

interface SessionQueryRow {
  id: string;
  date: string;
  workouts:
    | { name: string; splits: { name: string } | { name: string }[] | null }
    | Array<{ name: string; splits: { name: string } | { name: string }[] | null }>
    | null;
}

interface LiftSetQueryRow {
  session_id: string;
  exercise_name: string | null;
  weight: unknown;
  reps: unknown;
}

interface HistoricalQueryRow {
  session_key: string;
  date: string;
  date_estimated: boolean | null;
  split_name: string;
  split_abbr: string;
  exercise_name: string;
  weight: unknown;
  reps: unknown;
  is_drop_set: boolean | null;
  excluded_reason: string | null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unwrap<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Fetch every row of a query in pages (PostgREST caps a single request at 1000). */
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

/**
 * Peak Strength report: the user's app log plus their imported pre-app
 * history, scored per lift lineage. Only this endpoint reads
 * `historical_lift_sets`, so the Analytics/dashboard views stay app-only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
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

    const sessionRows = await fetchAllPages<SessionQueryRow>((from, to) =>
      supabase
        .from('sessions')
        .select('id, date, workouts(name, splits(name))')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .range(from, to),
    );
    const sessionIds = sessionRows.map((r) => r.id);
    const setRows: LiftSetQueryRow[] =
      sessionIds.length === 0
        ? []
        : await fetchAllPages<LiftSetQueryRow>((from, to) =>
            supabase
              .from('lift_sets')
              .select('session_id, exercise_name, weight, reps')
              .in('session_id', sessionIds)
              .range(from, to),
          );
    const historyRows = await fetchAllPages<HistoricalQueryRow>((from, to) =>
      supabase
        .from('historical_lift_sets')
        .select('session_key, date, date_estimated, split_name, split_abbr, exercise_name, weight, reps, is_drop_set, excluded_reason')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .range(from, to),
    );

    const sessionMeta = new Map<string, { date: string; splitName: string; splitAbbr: string }>();
    for (const row of sessionRows) {
      const workout = unwrap(row.workouts);
      const split = workout ? unwrap(workout.splits) : null;
      const splitName = split?.name ?? '';
      sessionMeta.set(row.id, { date: row.date, splitName, splitAbbr: splitAbbreviation(splitName) });
    }

    const rows: PeakSetRow[] = [];
    for (const set of setRows) {
      const meta = sessionMeta.get(set.session_id);
      const name = (set.exercise_name ?? '').trim();
      if (!meta || !name) continue;
      rows.push({
        sessionKey: set.session_id,
        date: meta.date,
        dateEstimated: false,
        splitName: meta.splitName,
        splitAbbr: meta.splitAbbr,
        exerciseName: name,
        weight: toNumber(set.weight),
        reps: toNumber(set.reps),
        source: 'app',
      });
    }
    for (const h of historyRows) {
      rows.push({
        sessionKey: h.session_key,
        date: h.date,
        dateEstimated: h.date_estimated !== false,
        splitName: h.split_name,
        splitAbbr: h.split_abbr,
        exerciseName: h.exercise_name,
        weight: toNumber(h.weight),
        reps: toNumber(h.reps),
        // Drop sets score at their midpoint load; only flagged outliers sit out.
        excluded: h.excluded_reason != null,
        source: 'history',
      });
    }

    res.status(200).json(computePeakReport(rows, new Date()));
  } catch (error) {
    console.error('Error in getPeak:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
