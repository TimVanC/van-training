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

    const rawTarget = req.query.targetSets;
    const targetSets = typeof rawTarget === 'string' ? Math.max(1, parseInt(rawTarget, 10) || 3) : 3;
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

    const queryResult = await supabase
      .from('lift_sets')
      .select('weight,reps,rir,created_at,sessions!inner(user_id,date)')
      .eq('exercise_name', exerciseName)
      .eq('sessions.user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (queryResult.error) {
      throw queryResult.error;
    }

    const rows = queryResult.data ?? [];
    if (rows.length > 0) {
      const mostRecent = rows[0];
      const recentSession = Array.isArray(mostRecent.sessions)
        ? mostRecent.sessions[0]
        : mostRecent.sessions;
      lastTrained = toDateOnly(recentSession?.date) ?? toDateOnly(mostRecent.created_at);

      const selected = rows.slice(0, targetSets);
      sets = selected.map((row) => ({
        weight: toFiniteNumber(row.weight),
        reps: toFiniteNumber(row.reps),
        rir: toFiniteNumber(row.rir),
      }));

      const topSetWeight = toFiniteNumber(selected[0]?.weight);
      const topSetReps = toFiniteNumber(selected[0]?.reps);
      const totalReps = selected.reduce((sum, row) => sum + toFiniteNumber(row.reps), 0);
      progressionMetrics = {
        ...(topSetWeight > 0 ? { lastTopSetWeight: topSetWeight } : {}),
        ...(topSetReps > 0 ? { lastTopSetReps: topSetReps } : {}),
        ...(topSetWeight > 0 && topSetReps > 0
          ? { estimatedOneRepMax: computeEstimatedOneRepMax(topSetWeight, topSetReps) }
          : {}),
        totalReps,
      };

      recommendedPlan = null;
      previousNote = undefined;
    }

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, progressionMetrics });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
