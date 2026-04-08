import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ensures the user has at least one split.
 * Workout/exercise structure is seeded from CSV by seedSplitFromCsv.
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

    if (!newSplit) throw new Error('Failed to create default split');
  } catch (err) {
    console.error('ensureUserSetup failed', err);
  }
}
