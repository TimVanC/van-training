import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface ExerciseHistoryRow {
  date: string;
  weight: number;
  reps: number;
  volume: number;
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
  if (!exerciseName) {
    res.status(400).json({ error: 'Missing exercise_name query parameter' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const query = await supabase
      .from('lift_sets')
      .select('weight,reps,volume,created_at')
      .eq('exercise_name', exerciseName)
      .order('created_at', { ascending: true });

    if (query.error) {
      throw query.error;
    }

    const results = (query.data ?? []).map((row) => {
      const createdAt = String(row.created_at ?? '');
      const date = createdAt ? createdAt.split('T')[0] ?? createdAt : '';
      return {
        date,
        weight: Number(row.weight) || 0,
        reps: Number(row.reps) || 0,
        volume: Number(row.volume) || 0,
      };
    }) satisfies ExerciseHistoryRow[];

    res.status(200).json(results);
  } catch (error) {
    console.error('Error in getExerciseHistory:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
