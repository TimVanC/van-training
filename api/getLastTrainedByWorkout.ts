import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface SessionWorkoutRow {
  workout_id: string;
  date: string;
}

interface LastTrainedByWorkoutRow {
  workout_id: string;
  last_trained: string;
}

function toIsoString(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
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

    const sessionsResult = await supabase
      .from('sessions')
      .select('workout_id,date,lift_sets!inner(id)')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (sessionsResult.error) {
      throw sessionsResult.error;
    }

    const rows = (sessionsResult.data ?? []) as SessionWorkoutRow[];
    const seen = new Set<string>();
    const responseRows: LastTrainedByWorkoutRow[] = [];
    for (const row of rows) {
      const workoutId = String(row.workout_id ?? '').trim();
      if (!workoutId || seen.has(workoutId)) continue;
      const iso = toIsoString(row.date);
      if (!iso) continue;
      seen.add(workoutId);
      responseRows.push({ workout_id: workoutId, last_trained: iso });
    }

    res.status(200).json(responseRows);
  } catch (error) {
    console.error('Error in getLastTrainedByWorkout:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
