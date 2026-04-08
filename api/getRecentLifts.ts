import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
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
  | { plate45: number; plate35: number; plate25: number; plate10: number; sled: number }
  | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const plate45 = Number(o.plate45);
  const plate35 = Number(o.plate35);
  const plate25 = Number(o.plate25);
  const plate10 = Number(o.plate10);
  const sled = Number(o.sled);
  if (
    !Number.isFinite(plate45) ||
    !Number.isFinite(plate35) ||
    !Number.isFinite(plate25) ||
    !Number.isFinite(plate10) ||
    !Number.isFinite(sled)
  ) {
    return undefined;
  }
  return { plate45, plate35, plate25, plate10, sled };
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
): Promise<{ data: LiftSetQueryRow[] | null; error: unknown }> {
  const selectCols = includePlateData
    ? 'session_id,exercise_name,weight,reps,rir,plate_data,created_at'
    : 'session_id,exercise_name,weight,reps,rir,created_at';

  const result = await supabase
    .from('lift_sets')
    .select(selectCols)
    .eq('session_id', sessionId)
    .eq('exercise_name', exerciseName)
    .order('created_at', { ascending: true });

  return { data: (result.data ?? null) as LiftSetQueryRow[] | null, error: result.error };
}

async function fetchLatestSession(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  exerciseName: string,
  includeNotes: boolean,
): Promise<{ data: SessionJoinRow | null; error: unknown }> {
  const sessionCols = includeNotes ? 'id,date,notes' : 'id,date';
  const result = await supabase
    .from('sessions')
    .select(`${sessionCols},lift_sets!inner(exercise_name)`)
    .eq('user_id', userId)
    .eq('lift_sets.exercise_name', exerciseName)
    .order('date', { ascending: false })
    .limit(1);

  return {
    data: ((result.data ?? [])[0] as SessionJoinRow | undefined) ?? null,
    error: result.error,
  };
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

    let latestSessionResult = await fetchLatestSession(supabase, userId, exerciseName, true);
    if (latestSessionResult.error && isMissingColumnError(latestSessionResult.error, 'notes')) {
      latestSessionResult = await fetchLatestSession(supabase, userId, exerciseName, false);
    }
    if (latestSessionResult.error) throw latestSessionResult.error;

    const latestSession = latestSessionResult.data;
    if (latestSession) {
      lastTrained = toDateOnly(latestSession.date);
      const latestNote = String(latestSession.notes ?? '').trim();
      previousNote = latestNote || undefined;

      let rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, true);
      if (rowsResult.error && isMissingColumnError(rowsResult.error, 'plate_data')) {
        rowsResult = await fetchLiftRows(supabase, latestSession.id, exerciseName, false);
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
    recommendedPlan = null;

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, progressionMetrics });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
