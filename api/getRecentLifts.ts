import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { buildProgressionPlan } from '../src/lib/progression.js';
import type { ProgressionPhase } from '../src/lib/progression.js';

interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
  plateBreakdown?: { plate45: number; plate35: number; plate25: number; plate10: number; plate5: number; plate2_5: number; sled: number };
}

interface HistorySession {
  date: string;
  sets: RecentLiftEntry[];
}

interface RecommendedPlanSet {
  setNumber: number;
  weight: number;
  targetReps: number;
  targetRIR: number;
}

interface ProgressionMetrics {
  lastTopSetWeight?: number;
  lastTopSetReps?: number;
  estimatedOneRepMax?: number;
  totalReps?: number;
}

interface SessionJoinRow {
  id: string;
  user_id: string;
  date: string;
  notes?: string | null;
}

interface LiftSetQueryRow {
  session_id: string;
  exercise_name?: string;
  set_number?: unknown;
  weight: unknown;
  reps: unknown;
  rir: unknown;
  plate_data?: unknown;
  created_at: unknown;
}

function toDateOnly(isoOrDate: unknown): string | undefined {
  const value = String(isoOrDate ?? '').trim();
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeEstimatedOneRepMax(weight: number, reps: number): number | undefined {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps <= 0) return undefined;
  return Number((weight * (1 + reps / 30)).toFixed(1));
}

function parsePlateData(value: unknown):
  | { plate45: number; plate35: number; plate25: number; plate10: number; plate5: number; plate2_5: number; sled: number }
  | undefined {
  let source: unknown = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return undefined;
    try {
      source = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (source === null || typeof source !== 'object') return undefined;
  const o = source as Record<string, unknown>;
  const plate45 = Number(o['45'] ?? o.plate45 ?? 0);
  const plate35 = Number(o['35'] ?? o.plate35 ?? 0);
  const plate25 = Number(o['25'] ?? o.plate25 ?? 0);
  const plate10 = Number(o['10'] ?? o.plate10 ?? 0);
  const plate5 = Number(o['5'] ?? o.plate5 ?? 0);
  const plate2_5 = Number(o['2.5'] ?? o.plate2_5 ?? 0);
  const sled = Number(o.sled ?? 0);
  if (
    !Number.isFinite(plate45) ||
    !Number.isFinite(plate35) ||
    !Number.isFinite(plate25) ||
    !Number.isFinite(plate10) ||
    !Number.isFinite(plate5) ||
    !Number.isFinite(plate2_5) ||
    !Number.isFinite(sled) ||
    plate45 < 0 ||
    plate35 < 0 ||
    plate25 < 0 ||
    plate10 < 0 ||
    plate5 < 0 ||
    plate2_5 < 0 ||
    sled < 0
  ) {
    return undefined;
  }
  return { plate45, plate35, plate25, plate10, plate5, plate2_5, sled };
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; details?: unknown };
  const message = String(e.message ?? '');
  const details = String(e.details ?? '');
  return message.includes(columnName) || details.includes(columnName);
}

async function fetchLiftRows(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  exerciseName: string,
  includePlateData: boolean,
  orderBySetNumber: boolean,
): Promise<{ data: LiftSetQueryRow[] | null; error: unknown }> {
  const baseCols = includePlateData
    ? 'session_id,exercise_name,set_number,weight,reps,rir,plate_data,created_at'
    : 'session_id,exercise_name,set_number,weight,reps,rir,created_at';
  const fallbackCols = includePlateData
    ? 'session_id,exercise_name,weight,reps,rir,plate_data,created_at'
    : 'session_id,exercise_name,weight,reps,rir,created_at';
  const selectCols = orderBySetNumber ? baseCols : fallbackCols;
  const orderBy = orderBySetNumber ? 'set_number' : 'created_at';

  const query = supabase
    .from('lift_sets')
    .select(selectCols)
    .eq('session_id', sessionId)
    .eq('exercise_name', exerciseName)
    .order(orderBy, { ascending: true });
  const result = await query;

  return { data: (result.data ?? null) as LiftSetQueryRow[] | null, error: result.error };
}

async function fetchRecentSessions(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  exerciseName: string,
  includeNotes: boolean,
  limit = 2,
): Promise<{ data: SessionJoinRow[]; error: unknown }> {
  const sessionCols = includeNotes ? 'id,date,notes' : 'id,date';
  const result = await supabase
    .from('sessions')
    .select(`${sessionCols},lift_sets!inner(exercise_name)`)
    .eq('user_id', userId)
    .eq('lift_sets.exercise_name', exerciseName)
    .order('date', { ascending: false })
    .limit(limit);

  return {
    data: (result.data ?? []) as SessionJoinRow[],
    error: result.error,
  };
}

/**
 * Fetch lift rows for one session with the same column-fallback chain used
 * for the latest/previous session queries. Throws on a genuine error so the
 * caller can decide how to surface it.
 */
async function fetchLiftRowsWithFallback(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  exerciseName: string,
): Promise<LiftSetQueryRow[]> {
  let result = await fetchLiftRows(supabase, sessionId, exerciseName, true, true);
  if (result.error && isMissingColumnError(result.error, 'set_number')) {
    result = await fetchLiftRows(supabase, sessionId, exerciseName, true, false);
  }
  if (result.error && isMissingColumnError(result.error, 'plate_data')) {
    result = await fetchLiftRows(supabase, sessionId, exerciseName, false, true);
  }
  if (result.error && isMissingColumnError(result.error, 'set_number')) {
    result = await fetchLiftRows(supabase, sessionId, exerciseName, false, false);
  }
  if (result.error) throw result.error;
  return result.data ?? [];
}

function parseRepRange(
  value: unknown,
): { min: number; max: number } | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const matched = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (matched) {
    const min = Number(matched[1]);
    const max = Number(matched[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return undefined;
    return min <= max ? { min, max } : { min: max, max: min };
  }
  const single = Number(raw);
  if (!Number.isFinite(single) || single <= 0) return undefined;
  return { min: single, max: single };
}

/** RIR for progression decisions: missing/invalid values are treated as 1. */
function toProgressionRir(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const exerciseName = typeof req.query.exercise === 'string' ? req.query.exercise.trim() : '';
    if (!exerciseName) {
      res.status(400).json({ error: 'Missing exercise query parameter' });
      return;
    }
    const requestedTargetSets =
      typeof req.query.targetSets === 'string' ? Number(req.query.targetSets) : Number.NaN;
    const targetSets =
      Number.isFinite(requestedTargetSets) && requestedTargetSets > 0
        ? Math.floor(requestedTargetSets)
        : 3;
    const repRange = parseRepRange(req.query.repRange);

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

    let lastTrained: string | undefined;
    let sets: RecentLiftEntry[] = [];
    let previousNote: string | undefined;
    let recommendedPlan: RecommendedPlanSet[] | null = null;
    let progressionMetrics: ProgressionMetrics | undefined;
    let sessionHistory: HistorySession[] = [];

    let recentSessionsResult = await fetchRecentSessions(supabase, userId, exerciseName, true);
    if (recentSessionsResult.error && isMissingColumnError(recentSessionsResult.error, 'notes')) {
      recentSessionsResult = await fetchRecentSessions(supabase, userId, exerciseName, false);
    }
    if (recentSessionsResult.error) throw recentSessionsResult.error;

    const recentSessions = recentSessionsResult.data;
    const latestSession = recentSessions[0];
    if (latestSession) {
      lastTrained = toDateOnly(latestSession.date);
      const latestNote = String(latestSession.notes ?? '').trim();
      previousNote = latestNote || undefined;

      let rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, true, true);
      if (rowsResult.error && isMissingColumnError(rowsResult.error, 'set_number')) {
        rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, true, false);
      }
      if (rowsResult.error && isMissingColumnError(rowsResult.error, 'plate_data')) {
        rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, false, true);
      }
      if (rowsResult.error && isMissingColumnError(rowsResult.error, 'set_number')) {
        rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, false, false);
      }
      if (rowsResult.error) throw rowsResult.error;

      const latestSessionRows = rowsResult.data ?? [];
      if (latestSessionRows.length > 0) {
        sets = latestSessionRows
          .map((row) => ({
            weight: toFiniteNumber(row.weight),
            reps: toFiniteNumber(row.reps),
            rir: toFiniteNumber(row.rir),
            plateBreakdown: parsePlateData(row.plate_data),
          }))
          .slice(0, targetSets);

        const topSetWeight = toFiniteNumber(latestSessionRows[0].weight);
        const topSetReps = toFiniteNumber(latestSessionRows[0].reps);
        const totalReps = latestSessionRows.reduce((sum, row) => sum + toFiniteNumber(row.reps), 0);
        progressionMetrics = {
          ...(topSetWeight > 0 ? { lastTopSetWeight: topSetWeight } : {}),
          ...(topSetReps > 0 ? { lastTopSetReps: topSetReps } : {}),
          ...(topSetWeight > 0 && topSetReps > 0
            ? { estimatedOneRepMax: computeEstimatedOneRepMax(topSetWeight, topSetReps) }
            : {}),
          totalReps,
        };
      }

    }

    try {
      const historySessionsResult = await fetchRecentSessions(supabase, userId, exerciseName, false, 10);
      if (historySessionsResult.error) throw historySessionsResult.error;

      const historySessions = historySessionsResult.data.slice(0, 10);
      const historyEntries = await Promise.all(
        historySessions.map(async (sessionRow) => {
          const dateOnly = toDateOnly(sessionRow.date);
          if (!dateOnly) return null;
          const rows = await fetchLiftRowsWithFallback(supabase, sessionRow.id, exerciseName);
          if (rows.length === 0) return null;
          const entry: HistorySession = {
            date: dateOnly,
            sets: rows.map((row) => ({
              weight: toFiniteNumber(row.weight),
              reps: toFiniteNumber(row.reps),
              rir: toFiniteNumber(row.rir),
              plateBreakdown: parsePlateData(row.plate_data),
            })),
          };
          return entry;
        }),
      );
      sessionHistory = historyEntries.filter((entry): entry is HistorySession => entry !== null);
    } catch (historyError) {
      // History is additive — never fail the whole request if it can't load.
      console.error('Failed to load session history:', historyError);
      sessionHistory = [];
    }

    // The progression engine reads the ladder position straight from history
    // (most recent session first) — no stored state needed.
    let planPhase: ProgressionPhase | undefined;
    let planRationale: string | undefined;
    if (sessionHistory.length > 0) {
      const plan = buildProgressionPlan({
        exerciseName,
        history: sessionHistory.map((entry) =>
          entry.sets.map((set) => ({
            weight: toFiniteNumber(set.weight),
            reps: toFiniteNumber(set.reps),
            rir: toProgressionRir(set.rir),
          })),
        ),
        repRange,
        targetSets,
      });
      if (plan) {
        recommendedPlan = plan.sets;
        planPhase = plan.phase;
        planRationale = plan.rationale;
      }
    }

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, planPhase, planRationale, progressionMetrics, sessionHistory });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
