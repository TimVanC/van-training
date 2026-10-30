import type { SessionRow } from '../types/rows';
import type { ExerciseNote } from './normalizeSession';
import { supabase } from './supabaseClient';

export interface SubmitWorkoutPayload {
  rows: SessionRow[];
  /** Required for lift logs; omit for run/bike/swim. */
  workout_id?: string;
  /** Day-level note. */
  notes?: string;
  /** One note per exercise, independent of the set rows. */
  exercise_notes?: ExerciseNote[];
}

export async function submitWorkout(
  rows: SessionRow[],
  workout_id?: string,
  notes?: string,
  exerciseNotes: ExerciseNote[] = [],
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const noteValue = typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : undefined;
    const payload: SubmitWorkoutPayload = {
      rows,
      ...(workout_id !== undefined && workout_id.length > 0 ? { workout_id } : {}),
      ...(noteValue ? { notes: noteValue } : {}),
      ...(exerciseNotes.length > 0 ? { exercise_notes: exerciseNotes } : {}),
    };

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
