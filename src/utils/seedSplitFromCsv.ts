import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSplitsFromCsv } from '../data/parseSplitsCsv';
import csvText from '../data/updated Split.csv?raw';
import type { Exercise } from '../types/lift';

interface SplitRow {
  id: string;
  name: string;
}

interface WorkoutRow {
  id: string;
  split_id: string;
  name: string;
  order_index: number;
}

interface ExerciseRow {
  id: string;
  name: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isImportSplit(name: string): boolean {
  return normalizeName(name) === 'import split';
}

function isImportWorkout(name: string): boolean {
  return normalizeName(name) === 'import workout';
}

async function getUserSplits(supabase: SupabaseClient, userId: string): Promise<SplitRow[]> {
  const { data, error } = await supabase
    .from('splits')
    .select('id, name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SplitRow[];
}

async function getOrCreateTargetSplit(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ split: SplitRow; allSplits: SplitRow[] }> {
  const allSplits = await getUserSplits(supabase, userId);
  const validSplits = allSplits.filter((s) => !isImportSplit(s.name));
  const existingTarget = validSplits.find((s) => s.name === 'PPLs') ?? validSplits[0];

  if (existingTarget) {
    return { split: existingTarget, allSplits };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('splits')
    .insert({ user_id: userId, name: 'PPLs' })
    .select('id, name')
    .single();

  if (insertError || !inserted) {
    const retrySplits = await getUserSplits(supabase, userId);
    const retryTarget = retrySplits.find((s) => !isImportSplit(s.name));
    if (!retryTarget) throw insertError ?? new Error('Unable to create or load target split');
    return { split: retryTarget, allSplits: retrySplits };
  }

  const nextSplits = [...allSplits, inserted as SplitRow];
  return { split: inserted as SplitRow, allSplits: nextSplits };
}

async function getUserWorkouts(
  supabase: SupabaseClient,
  splitIds: string[],
): Promise<WorkoutRow[]> {
  if (splitIds.length === 0) return [];
  const { data, error } = await supabase
    .from('workouts')
    .select('id, split_id, name, order_index')
    .in('split_id', splitIds);
  if (error) throw error;
  return (data ?? []) as WorkoutRow[];
}

function shouldSeed(workouts: WorkoutRow[]): boolean {
  if (workouts.length === 0) return true;
  return workouts.every((w) => isImportWorkout(w.name));
}

function getTemplateRows(): Array<{ workoutName: string; exercises: Exercise[]; orderIndex: number }> {
  const template = buildSplitsFromCsv(csvText)[0];
  if (!template) throw new Error('CSV template is empty');
  return Object.entries(template.days).map(([workoutName, exercises], idx) => ({
    workoutName,
    exercises,
    orderIndex: idx + 1,
  }));
}

export async function seedSplitFromCsv(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { split: targetSplit, allSplits } = await getOrCreateTargetSplit(supabase, userId);
  const splitIds = Array.from(new Set(allSplits.map((s) => s.id)));
  const existingWorkouts = await getUserWorkouts(supabase, splitIds);
  if (!shouldSeed(existingWorkouts)) return;

  const templateRows = getTemplateRows();

  const workoutUpserts = templateRows.map((row) => ({
    split_id: targetSplit.id,
    name: row.workoutName,
    order_index: row.orderIndex,
  }));

  const { error: upsertWorkoutsError } = await supabase
    .from('workouts')
    .upsert(workoutUpserts, { onConflict: 'split_id,order_index' });
  if (upsertWorkoutsError) throw upsertWorkoutsError;

  const { data: workoutsData, error: workoutsError } = await supabase
    .from('workouts')
    .select('id, split_id, name, order_index')
    .eq('split_id', targetSplit.id)
    .order('order_index', { ascending: true });
  if (workoutsError) throw workoutsError;

  const seededWorkouts = (workoutsData ?? []) as WorkoutRow[];
  const workoutIds = seededWorkouts.map((w) => w.id);
  const workoutIdByOrder = new Map<number, string>(
    seededWorkouts.map((w) => [w.order_index, w.id] as const),
  );

  const uniqueExerciseNames = Array.from(
    new Set(templateRows.flatMap((row) => row.exercises.map((e) => e.exercise))),
  );

  const exerciseUpserts = uniqueExerciseNames.map((name) => ({ name }));
  const { error: upsertExercisesError } = await supabase
    .from('exercises')
    .upsert(exerciseUpserts, { onConflict: 'name' });
  if (upsertExercisesError) throw upsertExercisesError;

  const { data: exercisesData, error: exercisesError } = await supabase
    .from('exercises')
    .select('id, name')
    .in('name', uniqueExerciseNames);
  if (exercisesError) throw exercisesError;

  const exerciseIdByName = new Map<string, string>(
    ((exercisesData ?? []) as ExerciseRow[]).map((e) => [e.name, e.id] as const),
  );

  if (workoutIds.length > 0) {
    const { error: deleteWorkoutExercisesError } = await supabase
      .from('workout_exercises')
      .delete()
      .in('workout_id', workoutIds);
    if (deleteWorkoutExercisesError) throw deleteWorkoutExercisesError;
  }

  const workoutExerciseRows: Array<{
    workout_id: string;
    exercise_id: string;
    sets: number;
    rep_range: string;
    order_index: number;
  }> = [];

  for (const row of templateRows) {
    const workoutId = workoutIdByOrder.get(row.orderIndex);
    if (!workoutId) continue;
    row.exercises.forEach((exercise, idx) => {
      const exerciseId = exerciseIdByName.get(exercise.exercise);
      if (!exerciseId) return;
      workoutExerciseRows.push({
        workout_id: workoutId,
        exercise_id: exerciseId,
        sets: exercise.sets,
        rep_range: exercise.repRange,
        order_index: idx + 1,
      });
    });
  }

  if (workoutExerciseRows.length > 0) {
    const { error: insertWorkoutExercisesError } = await supabase
      .from('workout_exercises')
      .insert(workoutExerciseRows);
    if (insertWorkoutExercisesError) throw insertWorkoutExercisesError;
  }
}
