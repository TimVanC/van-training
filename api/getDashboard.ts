import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  buildCheckinInsights,
  computeRecentPrs,
  computeWeekStats,
  summarizeMuscleGroups,
  type AnalysisSessionRow,
  type AnalysisSetRow,
  type CheckinRow,
} from '../src/lib/analysis';
import { computeNextDayName, type RotationDay } from '../src/lib/rotation';

interface SessionQueryRow {
  id: string;
  date: string;
  workout_id: string;
  workouts:
    | { name: string; order_index: number; splits: { name: string } | { name: string }[] | null }
    | Array<{ name: string; order_index: number; splits: { name: string } | { name: string }[] | null }>
    | null;
}

interface LiftSetQueryRow {
  session_id: string;
  exercise_name: string | null;
  weight: unknown;
  reps: unknown;
  rir: unknown;
}

interface CheckinQueryRow {
  session_date: string;
  feel: number | null;
  effort: number | null;
  sleep: number | null;
  soreness: number | null;
  diet_quality: number | null;
  took_preworkout: boolean | null;
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

    // --- Load everything the dashboard needs in three queries ---------------
    const sessionRows = await fetchAllPages<SessionQueryRow>((from, to) =>
      supabase
        .from('sessions')
        .select('id, date, workout_id, workouts(name, order_index, splits(name))')
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
              .select('session_id, exercise_name, weight, reps, rir')
              .in('session_id', sessionIds)
              .range(from, to),
          );

    const checkinRows = await fetchAllPages<CheckinQueryRow>((from, to) =>
      supabase
        .from('workout_checkins')
        .select('session_date, feel, effort, sleep, soreness, diet_quality, took_preworkout')
        .eq('user_id', userId)
        .order('session_date', { ascending: true })
        .range(from, to),
    );

    // --- Normalize --------------------------------------------------------
    const sessions: AnalysisSessionRow[] = sessionRows.map((row) => {
      const workout = unwrap(row.workouts);
      const split = workout ? unwrap(workout.splits) : null;
      return {
        id: row.id,
        date: row.date,
        dayName: workout?.name ?? 'Workout',
        splitName: split?.name ?? '',
      };
    });

    const sets: AnalysisSetRow[] = setRows
      .filter((r) => (r.exercise_name ?? '').trim().length > 0)
      .map((r) => ({
        sessionId: r.session_id,
        exerciseName: (r.exercise_name ?? '').trim(),
        weight: toNumber(r.weight),
        reps: toNumber(r.reps),
        rir: toNumber(r.rir),
      }));

    const checkins: CheckinRow[] = checkinRows.map((r) => ({
      sessionDate: r.session_date,
      feel: r.feel,
      effort: r.effort,
      sleep: r.sleep,
      soreness: r.soreness,
      dietQuality: r.diet_quality,
      tookPreworkout: r.took_preworkout,
    }));

    // --- Analyze ----------------------------------------------------------
    const now = new Date();
    const muscleGroups = summarizeMuscleGroups(sessions, sets, now);
    const prs = computeRecentPrs(sessions, sets, now);
    const insights = buildCheckinInsights(sessions, sets, checkins);
    const weekStats = computeWeekStats(sessions, sets, now);

    // Per-session summary for the calendar and recent-activity views.
    const volumeBySession = new Map<string, { volume: number; sets: number }>();
    for (const set of sets) {
      const entry = volumeBySession.get(set.sessionId) ?? { volume: 0, sets: 0 };
      entry.volume += Math.max(0, set.weight) * set.reps;
      entry.sets += 1;
      volumeBySession.set(set.sessionId, entry);
    }
    const calendarSessions = sessions.map((s) => ({
      id: s.id,
      date: s.date,
      dayName: s.dayName,
      splitName: s.splitName,
      totalVolume: Math.round(volumeBySession.get(s.id)?.volume ?? 0),
      totalSets: volumeBySession.get(s.id)?.sets ?? 0,
    }));

    // --- Rotation: which day is up next? ----------------------------------
    const { data: splitRows, error: splitError } = await supabase
      .from('splits')
      .select('id, name, workouts(id, name, order_index)')
      .eq('user_id', userId);
    if (splitError) throw splitError;

    let rotation: { splitName: string; days: RotationDay[]; nextDayName: string | null } | null = null;
    const realSplits = ((splitRows ?? []) as Array<{
      id: string;
      name: string;
      workouts: Array<{ id: string; name: string; order_index: number }> | null;
    }>).filter((s) => s.name.trim().toLowerCase() !== 'import split');

    const split = realSplits[0];
    if (split) {
      const lastTrainedByDayName = new Map<string, string>();
      for (const session of sessions) {
        const existing = lastTrainedByDayName.get(session.dayName) ?? '';
        if (session.date > existing) lastTrainedByDayName.set(session.dayName, session.date);
      }
      // Duplicate day rows can exist (historical self-heal artifacts) — collapse
      // to one entry per name, keeping the configured order.
      const seen = new Set<string>();
      const days: RotationDay[] = [];
      for (const w of [...(split.workouts ?? [])].sort((a, b) => a.order_index - b.order_index)) {
        if (seen.has(w.name)) continue;
        seen.add(w.name);
        days.push({ name: w.name, lastTrained: lastTrainedByDayName.get(w.name) });
      }
      rotation = { splitName: split.name, days, nextDayName: computeNextDayName(days) };
    }

    // Check-in averages over the last 30 days for the wellness tiles.
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recent = checkins.filter((c) => c.sessionDate >= monthAgo);
    const avgOf = (vals: Array<number | null>) => {
      const nums = vals.filter((v): v is number => v != null);
      return nums.length === 0 ? null : Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1));
    };
    const checkinSummary = {
      count30d: recent.length,
      avgFeel: avgOf(recent.map((c) => c.feel)),
      avgEffort: avgOf(recent.map((c) => c.effort)),
      avgSleep: avgOf(recent.map((c) => c.sleep)),
      avgSoreness: avgOf(recent.map((c) => c.soreness)),
      avgDiet: avgOf(recent.map((c) => c.dietQuality)),
      preworkoutRate:
        recent.filter((c) => c.tookPreworkout != null).length > 0
          ? Math.round(
              (recent.filter((c) => c.tookPreworkout === true).length /
                recent.filter((c) => c.tookPreworkout != null).length) * 100,
            )
          : null,
    };

    res.status(200).json({
      sessions: calendarSessions,
      muscleGroups,
      prs,
      insights,
      weekStats,
      rotation,
      checkinSummary,
    });
  } catch (error) {
    console.error('Error in getDashboard:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
