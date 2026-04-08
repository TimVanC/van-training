import type { LiftSession } from '../types/session';
import { supabase } from './supabaseClient';

/**
 * Matches default PPLs bootstrap in ensureUserSetup (workouts.order_index 1–6).
 * Disambiguates duplicate workout names (e.g. two "Legs") within the same split.
 */
const PPLS_DAY_TO_ORDER_INDEX: Record<string, number> = {
  'Push A': 1,
  'Pull A': 2,
  'Legs + Shoulders': 3,
  'Push B': 4,
  'Pull B': 5,
  Legs: 6,
};

/**
 * Resolves the DB `workouts.id` for the current lift session (split + day from route).
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

  if (nameErr || !byName?.id) return null;
  return byName.id;
}
