import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate } from './_lib/auth.js';
import { sanitizeSplitDraft } from '../src/lib/splitDraft.js';

const MAX_SPLITS_PER_USER = 12;

interface ExerciseRow {
  id: string;
  name: string;
  is_archived: boolean | null;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Save a confirmed onboarding draft as a new split for the caller: the split,
 * its days in order, and each day's exercises. Exercises reuse the shared
 * catalog row when the name matches (so history lines up across splits) and
 * are created otherwise. Never touches an existing split.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let admin: SupabaseClient | null = null;
  let createdSplitId: string | null = null;
  try {
    const auth = await authenticate(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const { supabase, userId } = auth;
    admin = supabase;

    const cleaned = sanitizeSplitDraft((req.body ?? {}).draft);
    if ('error' in cleaned) {
      res.status(400).json({ error: cleaned.error });
      return;
    }
    const { draft } = cleaned;

    const { data: existingSplits, error: splitsError } = await supabase
      .from('splits')
      .select('name')
      .eq('user_id', userId);
    if (splitsError) throw splitsError;
    const taken = new Set(((existingSplits ?? []) as Array<{ name: string }>).map((s) => key(s.name)));
    if (taken.size >= MAX_SPLITS_PER_USER) {
      res.status(400).json({ error: 'You already have the maximum number of splits.' });
      return;
    }
    let splitName = draft.name;
    for (let suffix = 2; taken.has(key(splitName)); suffix += 1) splitName = `${draft.name} ${suffix}`;

    // Resolve every exercise name against the catalog before writing anything.
    const { data: catalogRows, error: catalogError } = await supabase
      .from('exercises')
      .select('id, name, is_archived')
      .limit(5000);
    if (catalogError) throw catalogError;
    const byName = new Map<string, ExerciseRow>();
    for (const row of (catalogRows ?? []) as ExerciseRow[]) byName.set(key(row.name), row);

    const wanted = new Map<string, string>();
    for (const day of draft.days) for (const ex of day.exercises) wanted.set(key(ex.name), ex.name);
    const archived = [...wanted.keys()].filter((k) => byName.get(k)?.is_archived);
    if (archived.length > 0) {
      res.status(400).json({
        error: `"${byName.get(archived[0])!.name}" isn't available. Rename that exercise and save again.`,
      });
      return;
    }
    const missing = [...wanted].filter(([k]) => !byName.has(k)).map(([, name]) => ({ name }));
    if (missing.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('exercises')
        .insert(missing)
        .select('id, name, is_archived');
      if (insertError) throw insertError;
      for (const row of (inserted ?? []) as ExerciseRow[]) byName.set(key(row.name), row);
    }

    const { data: split, error: splitError } = await supabase
      .from('splits')
      .insert({ user_id: userId, name: splitName })
      .select('id')
      .single();
    if (splitError || !split) throw splitError ?? new Error('Failed to create split');
    createdSplitId = (split as { id: string }).id;

    const { data: workouts, error: workoutsError } = await supabase
      .from('workouts')
      .insert(draft.days.map((day, i) => ({ split_id: createdSplitId, name: day.name, order_index: i + 1 })))
      .select('id, order_index');
    if (workoutsError) throw workoutsError;
    const workoutIdByOrder = new Map(
      ((workouts ?? []) as Array<{ id: string; order_index: number }>).map((w) => [w.order_index, w.id]),
    );

    const links = draft.days.flatMap((day, i) =>
      day.exercises.map((ex, j) => ({
        workout_id: workoutIdByOrder.get(i + 1),
        exercise_id: byName.get(key(ex.name))?.id,
        sets: ex.sets,
        rep_range: ex.repRange,
        order_index: j + 1,
      })),
    );
    if (links.some((l) => !l.workout_id || !l.exercise_id)) throw new Error('Failed to resolve split rows');
    const { error: linksError } = await supabase.from('workout_exercises').insert(links);
    if (linksError) throw linksError;

    res.status(200).json({ splitName });
  } catch (error) {
    console.error('Error in saveSplit:', error);
    if (admin && createdSplitId) {
      // Roll back the half-built split (workouts and their exercises cascade).
      const { error: cleanupError } = await admin.from('splits').delete().eq('id', createdSplitId);
      if (cleanupError) console.error('saveSplit cleanup failed:', cleanupError.message);
    }
    res.status(500).json({ error: "Couldn't save your split. Try again." });
  }
}
