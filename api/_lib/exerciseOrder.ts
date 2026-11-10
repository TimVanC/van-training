import type { createClient } from '@supabase/supabase-js';

/**
 * Program order for workout days: workout id -> lowercased exercise name ->
 * position. Lift sets don't record the order exercises were performed in
 * (a session is inserted in one batch), so the day's program order stands
 * in for it. Swapped-in exercises take the slot of the exercise they replace.
 */
export async function loadProgramOrder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workoutIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const ids = [...new Set(workoutIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const [slots, swaps] = await Promise.all([
    supabase
      .from('workout_exercises')
      .select('workout_id, order_index, exercises(name)')
      .in('workout_id', ids),
    supabase
      .from('exercise_swaps')
      .select('base_exercise_name, swap_exercise_name')
      .or(`user_id.eq.${userId},is_global.eq.true`),
  ]);
  if (slots.error) throw slots.error;

  const swapsByBase = new Map<string, string[]>();
  for (const row of (swaps.data ?? []) as Array<{ base_exercise_name: string | null; swap_exercise_name: string | null }>) {
    const base = (row.base_exercise_name ?? '').trim().toLowerCase();
    const swap = (row.swap_exercise_name ?? '').trim().toLowerCase();
    if (!base || !swap) continue;
    swapsByBase.set(base, [...(swapsByBase.get(base) ?? []), swap]);
  }

  type SlotRow = { workout_id: string; order_index: number | null; exercises: { name: string } | Array<{ name: string }> | null };
  for (const row of (slots.data ?? []) as SlotRow[]) {
    const exercise = Array.isArray(row.exercises) ? row.exercises[0] : row.exercises;
    const name = (exercise?.name ?? '').trim().toLowerCase();
    if (!name) continue;
    const order = out.get(row.workout_id) ?? new Map<string, number>();
    const pos = Number(row.order_index ?? 0);
    order.set(name, pos);
    for (const swap of swapsByBase.get(name) ?? []) {
      if (!order.has(swap)) order.set(swap, pos);
    }
    out.set(row.workout_id, order);
  }
  return out;
}
