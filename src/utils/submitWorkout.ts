import type { SessionRow } from '../types/rows';
import { supabase } from './supabaseClient';

export interface SubmitWorkoutPayload {
  rows: SessionRow[];
  /** Required for lift logs; omit for run/bike/swim. */
  workout_id?: string;
}

export async function submitWorkout(
  rows: SessionRow[],
  workout_id?: string,
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const payload: SubmitWorkoutPayload =
      workout_id !== undefined && workout_id.length > 0
        ? { rows, workout_id }
        : { rows };

    const res = await fetch('/api/appendWorkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
