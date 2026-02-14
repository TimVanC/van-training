import type { SessionRow } from '../types/rows';

export async function submitWorkout(rows: SessionRow[]): Promise<boolean> {
  try {
    const res = await fetch('/api/appendWorkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    return res.ok;
  } catch {
    return false;
  }
}
