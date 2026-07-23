import type { LiftSession } from '../types/session';
import { supabase } from './supabaseClient';

/**
 * Maps the PPLs day names to their workouts.order_index so a workout row can be
 * recreated on-the-fly if missing. Order indices are non-contiguous because the
 * standalone "Legs" day (6) was retired; "Core" (7) is an accessory day resolved
 * by name and intentionally omitted here.
 */
const PPLS_DAY_TO_ORDER_INDEX: Record<string, number> = {
  'Push A': 1,
  'Pull A': 2,
  'Legs + Shoulders': 3,
  'Push B': 4,
  'Pull B': 5,
};

/**
 * Resolves the DB `workouts.id` for the current lift session (split + day from route).
 *
 * If the workout row doesn't yet exist (e.g. a new day was added to the CSV
 * after the user's account was already seeded), this function creates the
 * row on-the-fly with the next available `order_index` so submissions never
 * fail with "could not find this workout".
 */
export async function resolveWorkoutIdForLiftSession(session: LiftSession): Promise<string | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: split, error: splitError } = await supabase
    .from('splits')
    .select('id')
    .eq('user_id', userData.user.id)
    .eq('name', session.split)
    .maybeSingle();

  if (splitError || !split) return null;

  const orderIndex = PPLS_DAY_TO_ORDER_INDEX[session.day];
  if (orderIndex !== undefined) {
    const { data: workout, error: wErr } = await supabase
      .from('workouts')
      .select('id')
      .eq('split_id', split.id)
      .eq('order_index', orderIndex)
      .maybeSingle();
    if (!wErr && workout?.id) return workout.id;
  }

  const { data: byName, error: nameErr } = await supabase
    .from('workouts')
    .select('id')
    .eq('split_id', split.id)
    .eq('name', session.day)
    .maybeSingle();

  if (!nameErr && byName?.id) return byName.id;

  // Self-heal: the day exists in the CSV but no workout row was seeded for
  // this user yet. Insert one with the next available order_index and
  // return its id so the lift submission can proceed.
  const { data: maxRow } = await supabase
    .from('workouts')
    .select('order_index')
    .eq('split_id', split.id)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrderIndex = (maxRow?.order_index ?? 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from('workouts')
    .insert({ split_id: split.id, name: session.day, order_index: nextOrderIndex })
    .select('id')
    .single();

  if (insertError || !inserted?.id) {
    // If another tab raced us, the row may now exist; re-read by name.
    const { data: retry } = await supabase
      .from('workouts')
      .select('id')
      .eq('split_id', split.id)
      .eq('name', session.day)
      .maybeSingle();
    return retry?.id ?? null;
  }

  return inserted.id;
}
