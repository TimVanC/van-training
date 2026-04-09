import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface LiftSetRow {
  session_id: string;
  weight: unknown;
  reps: unknown;
  rir: unknown;
  volume: unknown;
  created_at: unknown;
  sessions?: {
    date?: unknown;
  } | Array<{
    date?: unknown;
  }>;
}

interface SessionTopSet {
  weight: number;
  reps: number;
  rir: number;
}

interface SessionSummary {
  sessionId: string;
  date: string;
  topSetWeight: number;
  topSetReps: number;
  topSetRir: number;
  totalVolume: number;
}

interface RepPrEntry {
  weight: number;
  maxReps: number;
}

type DateRangeKey = '30D' | '90D' | '6M' | '1Y' | 'ALL';

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDateRange(value: unknown): DateRangeKey {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  if (normalized === '90D') return '90D';
  if (normalized === '6M') return '6M';
  if (normalized === '1Y') return '1Y';
  if (normalized === 'ALL') return 'ALL';
  return '30D';
}

function toUtcDateStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getRangeStartIso(range: DateRangeKey): string | null {
  if (range === 'ALL') return null;
  const now = toUtcDateStart(new Date());
  if (range === '30D') {
    now.setUTCDate(now.getUTCDate() - 30);
    return now.toISOString();
  }
  if (range === '90D') {
    now.setUTCDate(now.getUTCDate() - 90);
    return now.toISOString();
  }
  if (range === '6M') {
    now.setUTCMonth(now.getUTCMonth() - 6);
    return now.toISOString();
  }
  now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString();
}

function toDateOnly(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    return raw.includes('T') ? raw.split('T')[0] ?? raw : raw;
  }
  return parsed.toISOString().slice(0, 10);
}

function getSessionDate(row: LiftSetRow): string {
  const join = row.sessions;
  if (Array.isArray(join)) {
    return toDateOnly(join[0]?.date ?? row.created_at);
  }
  return toDateOnly(join?.date ?? row.created_at);
}

function identifyTopSet(sets: LiftSetRow[]): SessionTopSet | null {
  const normalized = sets.map((set) => ({
    weight: toFiniteNumber(set.weight),
    reps: toFiniteNumber(set.reps),
    rir: toFiniteNumber(set.rir),
  }));
  const workingSets = normalized.filter((set) => set.weight > 0 && set.reps > 0);
  if (workingSets.length === 0) return null;

  const firstWorkingSet = workingSets[0];
  let highestWeightSet = firstWorkingSet;
  for (const set of workingSets.slice(1)) {
    if (set.weight > highestWeightSet.weight) {
      highestWeightSet = set;
    }
  }
  return highestWeightSet.weight > firstWorkingSet.weight ? highestWeightSet : firstWorkingSet;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const exerciseNameParam = req.query.exercise_name;
  const exerciseName = typeof exerciseNameParam === 'string' ? exerciseNameParam.trim() : '';
  const range = parseDateRange(req.query.range);
  const rangeStartIso = getRangeStartIso(range);

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

    const exerciseQuery = await supabase
      .from('lift_sets')
      .select('exercise_name,sessions!inner(user_id)')
      .eq('sessions.user_id', userId);

    if (exerciseQuery.error) {
      throw exerciseQuery.error;
    }

    const exercises = Array.from(
      new Set(
        (exerciseQuery.data ?? [])
          .map((row) => String((row as Record<string, unknown>).exercise_name ?? '').trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    if (!exerciseName) {
      res.status(200).json({ exercises, sessions: [], repPrs: [] });
      return;
    }

    let historyQuery = supabase
      .from('lift_sets')
      .select('session_id,weight,reps,rir,volume,created_at,sessions!inner(user_id,date)')
      .eq('sessions.user_id', userId)
      .eq('exercise_name', exerciseName)
      .order('created_at', { ascending: true });
    if (rangeStartIso) {
      historyQuery = historyQuery.gte('sessions.date', rangeStartIso);
    }
    const historyResult = await historyQuery;

    if (historyResult.error) {
      throw historyResult.error;
    }

    const rows = (historyResult.data ?? []) as LiftSetRow[];
    const sessionMap = new Map<string, { date: string; sets: LiftSetRow[] }>();
    for (const row of rows) {
      const sessionId = String(row.session_id ?? '').trim();
      if (!sessionId) continue;
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, { date: getSessionDate(row), sets: [row] });
      } else {
        const existing = sessionMap.get(sessionId);
        if (!existing) continue;
        if (!existing.date) existing.date = getSessionDate(row);
        existing.sets.push(row);
      }
    }

    const sessionSummaries: SessionSummary[] = [];
    for (const [sessionId, data] of sessionMap.entries()) {
      const topSet = identifyTopSet(data.sets);
      if (!topSet) continue;
      const totalVolume = data.sets.reduce((sum, set) => {
        const weight = toFiniteNumber(set.weight);
        const reps = toFiniteNumber(set.reps);
        const volume = toFiniteNumber(set.volume);
        return sum + (volume > 0 ? volume : weight * reps);
      }, 0);
      sessionSummaries.push({
        sessionId,
        date: data.date,
        topSetWeight: topSet.weight,
        topSetReps: topSet.reps,
        topSetRir: topSet.rir,
        totalVolume,
      });
    }

    sessionSummaries.sort((a, b) => a.date.localeCompare(b.date));

    const repPrMap = new Map<number, number>();
    for (const row of rows) {
      const weight = toFiniteNumber(row.weight);
      const reps = toFiniteNumber(row.reps);
      if (weight <= 0 || reps <= 0) continue;
      const currentMax = repPrMap.get(weight) ?? 0;
      if (reps > currentMax) {
        repPrMap.set(weight, reps);
      }
    }
    const repPrs: RepPrEntry[] = Array.from(repPrMap.entries())
      .map(([weight, maxReps]) => ({ weight, maxReps }))
      .sort((a, b) => b.weight - a.weight);

    res.status(200).json({
      exercises,
      sessions: sessionSummaries,
      repPrs,
      range,
    });
  } catch (error) {
    console.error('Error in getExerciseHistory:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
