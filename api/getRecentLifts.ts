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
  sessions: SessionJoinRow | SessionJoinRow[] | null;
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

function isMissingPlateDataColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; details?: unknown };
  const message = String(e.message ?? '');
  const details = String(e.details ?? '');
  return message.includes('plate_data') || details.includes('plate_data');
}

async function fetchLiftRows(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  exerciseName: string,
  includePlateData: boolean,
): Promise<{ data: LiftSetQueryRow[] | null; error: unknown }> {
  const selectCols = includePlateData
    ? 'session_id,exercise_name,weight,reps,rir,plate_data,created_at,sessions!inner(id,user_id,date,notes)'
    : 'session_id,exercise_name,weight,reps,rir,created_at,sessions!inner(id,user_id,date,notes)';

  const result = await supabase
    .from('lift_sets')
    .select(selectCols)
    .eq('exercise_name', exerciseName)
    .eq('sessions.user_id', userId)
    .order('date', { ascending: false, foreignTable: 'sessions' })
    .order('created_at', { ascending: false });

  return { data: (result.data ?? null) as LiftSetQueryRow[] | null, error: result.error };
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

    let rawRowsResult = await fetchLiftRows(supabase, userId, exerciseName, true);
    if (rawRowsResult.error && isMissingPlateDataColumnError(rawRowsResult.error)) {
      rawRowsResult = await fetchLiftRows(supabase, userId, exerciseName, false);
    }
    if (rawRowsResult.error) throw rawRowsResult.error;

    const rows = rawRowsResult.data ?? [];
    if (rows.length > 0) {
      const normalizedRows = rows
        .map((row) => ({
          ...row,
          session: Array.isArray(row.sessions) ? row.sessions[0] : row.sessions,
        }))
        .filter((row): row is LiftSetQueryRow & { session: SessionJoinRow } => row.session != null);

      if (normalizedRows.length > 0) {
        const latestSessionId = normalizedRows[0].session_id;
        const latestSessionRows = normalizedRows
          .filter((row) => row.session_id === latestSessionId)
          .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));

        if (latestSessionRows.length > 0) {
          lastTrained = toDateOnly(latestSessionRows[0].session.date) ?? toDateOnly(latestSessionRows[0].created_at);
          const latestNote = String(latestSessionRows[0].session.notes ?? '').trim();
          previousNote = latestNote || undefined;

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
      sets = sets.map((row) => ({
        weight: toFiniteNumber(row.weight),
        reps: toFiniteNumber(row.reps),
        rir: toFiniteNumber(row.rir),
      }));
    }
    recommendedPlan = null;

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, progressionMetrics });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
