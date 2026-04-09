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
  set_number?: unknown;
  weight: unknown;
  reps: unknown;
  rir: unknown;
  plate_data?: unknown;
  created_at: unknown;
}

interface NormalizedLiftSet {
  setNumber: number;
  weight: number;
  reps: number;
  rir: number;
  plateBreakdown?: { plate45: number; plate35: number; plate25: number; plate10: number; plate5: number; sled: number };
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
  | { plate45: number; plate35: number; plate25: number; plate10: number; plate5: number; sled: number }
  | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const plate45 = Number(o['45'] ?? o.plate45);
  const plate35 = Number(o['35'] ?? o.plate35);
  const plate25 = Number(o['25'] ?? o.plate25);
  const plate10 = Number(o['10'] ?? o.plate10);
  const plate5 = Number(o['5'] ?? o.plate5 ?? 0);
  const sled = Number(o.sled);
  if (
    !Number.isFinite(plate45) ||
    !Number.isFinite(plate35) ||
    !Number.isFinite(plate25) ||
    !Number.isFinite(plate10) ||
    !Number.isFinite(plate5) ||
    !Number.isFinite(sled)
  ) {
    return undefined;
  }
  return { plate45, plate35, plate25, plate10, plate5, sled };
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
): Promise<{ data: SessionJoinRow[]; error: unknown }> {
  const sessionCols = includeNotes ? 'id,date,notes' : 'id,date';
  const result = await supabase
    .from('sessions')
    .select(`${sessionCols},lift_sets!inner(exercise_name)`)
    .eq('user_id', userId)
    .eq('lift_sets.exercise_name', exerciseName)
    .order('date', { ascending: false })
    .limit(2);

  return {
    data: (result.data ?? []) as SessionJoinRow[],
    error: result.error,
  };
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

function normalizeLiftSets(rows: LiftSetQueryRow[]): NormalizedLiftSet[] {
  return rows.map((row, index) => {
    const parsedSetNumber = Math.trunc(Number(row.set_number));
    return {
      setNumber: Number.isFinite(parsedSetNumber) && parsedSetNumber > 0 ? parsedSetNumber : index + 1,
      weight: toFiniteNumber(row.weight),
      reps: toFiniteNumber(row.reps),
      // Missing RIR should be treated as 1 for progression decisions.
      rir: Number.isFinite(Number(row.rir)) && Number(row.rir) >= 0 ? Number(row.rir) : 1,
      plateBreakdown: parsePlateData(row.plate_data),
    };
  });
}

function identifyTopSet(sets: NormalizedLiftSet[]): NormalizedLiftSet | undefined {
  const workingSets = sets.filter((set) => set.weight > 0 && set.reps > 0);
  if (workingSets.length === 0) return undefined;
  const firstWorkingSet = workingSets[0];
  let highestWeightSet = firstWorkingSet;
  for (const set of workingSets.slice(1)) {
    if (set.weight > highestWeightSet.weight) highestWeightSet = set;
  }
  return highestWeightSet.weight > firstWorkingSet.weight ? highestWeightSet : firstWorkingSet;
}

function getWeightIncrement(exerciseName: string): number {
  const normalized = exerciseName.toLowerCase();
  if (normalized.includes('leg press')) return 20;
  if (normalized.includes('dumbbell')) return 5;
  return 10;
}

function toPlanWeight(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function clampReps(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function buildRecommendedPlan(params: {
  exerciseName: string;
  latestRows: LiftSetQueryRow[];
  previousRows: LiftSetQueryRow[];
  repRange: { min: number; max: number } | undefined;
  targetSets: number;
}): RecommendedPlanSet[] | null {
  const { exerciseName, latestRows, previousRows, repRange, targetSets } = params;
  if (!repRange || previousRows.length === 0 || latestRows.length === 0) return null;

  const latestSets = normalizeLiftSets(latestRows).slice(0, targetSets);
  const previousSets = normalizeLiftSets(previousRows);
  if (latestSets.length === 0 || previousSets.length === 0) return null;

  const topSet = identifyTopSet(latestSets);
  const previousTopSet = identifyTopSet(previousSets);
  if (!topSet || !previousTopSet) return null;

  const repMin = repRange.min;
  const repMax = repRange.max;
  const increment = getWeightIncrement(exerciseName);

  let nextTopWeight = topSet.weight;
  let nextTopReps = clampReps(topSet.reps, repMin, repMax);
  let nextTopRir = 1;

  const topSetHitRangeCap = topSet.reps >= repMax && topSet.rir <= 1;
  const sameWeightAsPreviousTop = topSet.weight === previousTopSet.weight;
  const topSetImproved =
    sameWeightAsPreviousTop &&
    (topSet.reps > previousTopSet.reps ||
      (topSet.reps === previousTopSet.reps && topSet.rir < previousTopSet.rir));
  const topSetRegressed =
    sameWeightAsPreviousTop &&
    (topSet.reps < previousTopSet.reps ||
      (topSet.reps === previousTopSet.reps && topSet.rir > previousTopSet.rir));

  if (topSetHitRangeCap) {
    nextTopWeight = topSet.weight + increment;
    nextTopReps = repMin;
    nextTopRir = 1;
  } else if (topSetImproved) {
    nextTopWeight = topSet.weight;
    nextTopReps = clampReps(topSet.reps + 1, repMin, repMax);
    nextTopRir = 1;
  } else if (topSetRegressed) {
    const clearRegression = topSet.reps < repMin || topSet.rir - previousTopSet.rir >= 2;
    nextTopWeight = clearRegression ? Math.max(0, topSet.weight - increment) : topSet.weight;
    nextTopReps = clampReps(topSet.reps, repMin, repMax);
    nextTopRir = 1;
  }

  return latestSets.map((set) => {
    const isTopSet = set.setNumber === topSet.setNumber;
    if (isTopSet) {
      return {
        setNumber: set.setNumber,
        weight: toPlanWeight(nextTopWeight),
        targetReps: nextTopReps,
        targetRIR: nextTopRir,
      };
    }
    return {
      setNumber: set.setNumber,
      weight: toPlanWeight(set.weight),
      targetReps: clampReps(set.reps + 1, repMin, repMax),
      targetRIR: set.rir,
    };
  });
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

    let recentSessionsResult = await fetchRecentSessions(supabase, userId, exerciseName, true);
    if (recentSessionsResult.error && isMissingColumnError(recentSessionsResult.error, 'notes')) {
      recentSessionsResult = await fetchRecentSessions(supabase, userId, exerciseName, false);
    }
    if (recentSessionsResult.error) throw recentSessionsResult.error;

    const recentSessions = recentSessionsResult.data;
    const latestSession = recentSessions[0];
    const previousSession = recentSessions[1];
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

      if (previousSession) {
        let previousRowsResult = await fetchLiftRows(supabase, previousSession.id, exerciseName, true, true);
        if (previousRowsResult.error && isMissingColumnError(previousRowsResult.error, 'set_number')) {
          previousRowsResult = await fetchLiftRows(supabase, previousSession.id, exerciseName, true, false);
        }
        if (previousRowsResult.error && isMissingColumnError(previousRowsResult.error, 'plate_data')) {
          previousRowsResult = await fetchLiftRows(supabase, previousSession.id, exerciseName, false, true);
        }
        if (previousRowsResult.error && isMissingColumnError(previousRowsResult.error, 'set_number')) {
          previousRowsResult = await fetchLiftRows(supabase, previousSession.id, exerciseName, false, false);
        }
        if (previousRowsResult.error) throw previousRowsResult.error;

        recommendedPlan = buildRecommendedPlan({
          exerciseName,
          latestRows: latestSessionRows,
          previousRows: previousRowsResult.data ?? [],
          repRange,
          targetSets,
        });
      }
    }

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, progressionMetrics });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
