import type { SessionRow } from '../types/rows';
import { supabase } from './supabaseClient';

export async function submitWorkout(rows: SessionRow[]): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const res = await fetch('/api/appendWorkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(rows),
    });
    return res.ok;
  } catch {
    return false;
  }
}
