import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_WORKOUTS: ReadonlyArray<{ name: string; order_index: number }> = [
  { name: 'Push A', order_index: 1 },
  { name: 'Pull A', order_index: 2 },
  { name: 'Legs', order_index: 3 },
  { name: 'Push B', order_index: 4 },
  { name: 'Pull B', order_index: 5 },
  { name: 'Legs', order_index: 6 },
];

async function insertDefaultWorkouts(
  supabase: SupabaseClient,
  splitId: string,
): Promise<void> {
  const rows = DEFAULT_WORKOUTS.map((w) => ({
    split_id: splitId,
    name: w.name,
    order_index: w.order_index,
  }));
  const { error } = await supabase.from('workouts').insert(rows);
  if (error) throw error;
}

/**
 * Ensures the user has at least one split with the default PPLs template.
 * Runs only when the user has no rows in `splits` (idempotent; safe on repeat calls).
 */
export async function ensureUserSetup(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    console.log('ensureUserSetup start', userId);

    const { data: splits, error: splitsError } = await supabase
      .from('splits')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    console.log('splits result', splits, splitsError);

    if (splitsError) throw splitsError;

    if (splits && splits.length > 0) {
      return;
    }

    const { data: newSplit, error: insertError } = await supabase
      .from('splits')
      .insert({ user_id: userId, name: 'PPLs' })
      .select()
      .single();

    if (insertError) {
      const { data: retrySplits, error: retryError } = await supabase
        .from('splits')
        .select('id')
        .eq('user_id', userId)
        .limit(1);
      if (retryError) throw retryError;
      if (retrySplits && retrySplits.length > 0) {
        return;
      }
      throw insertError;
    }

    if (!newSplit) {
      throw new Error('Failed to create default split');
    }

    await insertDefaultWorkouts(supabase, newSplit.id);
  } catch (err) {
    console.error('ensureUserSetup failed', err);
  }
}
