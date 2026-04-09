import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface ExerciseHistoryRow {
  date: string;
  weight: number;
  reps: number;
  volume: number;
  plate_data?: {
    '45': number;
    '35': number;
    '25': number;
    '10': number;
    '5': number;
    sled?: number;
  };
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
      .select('weight,reps,volume,plate_data,created_at')
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
        plate_data:
          row.plate_data && typeof row.plate_data === 'object'
            ? {
              '45': Number((row.plate_data as Record<string, unknown>)['45'] ?? (row.plate_data as Record<string, unknown>).plate45 ?? 0),
              '35': Number((row.plate_data as Record<string, unknown>)['35'] ?? (row.plate_data as Record<string, unknown>).plate35 ?? 0),
              '25': Number((row.plate_data as Record<string, unknown>)['25'] ?? (row.plate_data as Record<string, unknown>).plate25 ?? 0),
              '10': Number((row.plate_data as Record<string, unknown>)['10'] ?? (row.plate_data as Record<string, unknown>).plate10 ?? 0),
              '5': Number((row.plate_data as Record<string, unknown>)['5'] ?? (row.plate_data as Record<string, unknown>).plate5 ?? 0),
              ...(
                (row.plate_data as Record<string, unknown>).sled != null
                  ? { sled: Number((row.plate_data as Record<string, unknown>).sled ?? 0) }
                  : {}
              ),
            }
            : undefined,
      };
    }) satisfies ExerciseHistoryRow[];

    res.status(200).json(results);
  } catch (error) {
    console.error('Error in getExerciseHistory:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
