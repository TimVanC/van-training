import { createClient } from '@supabase/supabase-js';

type SessionRow = {
  id: string;
  workout_id: string;
  workouts: { name: string } | Array<{ name: string }> | null;
};

type WorkoutRow = {
  id: string;
  name: string;
  split_id: string;
};

type WorkoutExerciseRow = {
  workout_id: string;
  exercises: { name: string } | Array<{ name: string }> | null;
};

type LiftSetRow = {
  exercise_name: string;
};

type ScoredWorkout = {
  workoutId: string;
  workoutName: string;
  overlap: number;
};

const TARGET_USER_ID =
  process.env.SESSION_REMAP_USER_ID ?? 'e754e7e9-ff46-4788-a02a-a264db8d396d';
const IMPORT_WORKOUT_NAME = 'Import Workout';

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function workoutNameFromJoin(value: SessionRow['workouts']): string {
  if (!value) return '';
  if (Array.isArray(value)) return value[0]?.name ?? '';
  return value.name ?? '';
}

function exerciseNameFromJoin(value: WorkoutExerciseRow['exercises']): string {
  if (!value) return '';
  if (Array.isArray(value)) return value[0]?.name ?? '';
  return value.name ?? '';
}

function scoreWorkout(
  sessionExerciseNames: Set<string>,
  workoutExerciseNames: Set<string>,
  workoutId: string,
  workoutName: string,
): ScoredWorkout {
  let overlap = 0;
  for (const name of sessionExerciseNames) {
    if (workoutExerciseNames.has(name)) overlap += 1;
  }
  return { workoutId, workoutName, overlap };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const sessionsResult = await supabase
    .from('sessions')
    .select('id,workout_id,workouts!inner(name)')
    .eq('user_id', TARGET_USER_ID);
  if (sessionsResult.error) throw sessionsResult.error;
  const allSessions = (sessionsResult.data ?? []) as SessionRow[];

  const importSessions = allSessions.filter(
    (s) => workoutNameFromJoin(s.workouts) === IMPORT_WORKOUT_NAME,
  );

  if (importSessions.length === 0) {
    console.log('No sessions mapped to Import Workout.');
    return;
  }

  const workoutsResult = await supabase
    .from('workouts')
    .select('id,name,split_id,splits!inner(user_id)')
    .eq('splits.user_id', TARGET_USER_ID);
  if (workoutsResult.error) throw workoutsResult.error;

  const workouts = (workoutsResult.data ?? []) as Array<
    WorkoutRow & { splits: { user_id: string } | Array<{ user_id: string }> }
  >;
  const candidateWorkouts = workouts.filter((w) => w.name !== IMPORT_WORKOUT_NAME);
  if (candidateWorkouts.length === 0) {
    console.log('No candidate workouts found for user.');
    return;
  }

  const workoutIds = candidateWorkouts.map((w) => w.id);
  const workoutExercisesResult = await supabase
    .from('workout_exercises')
    .select('workout_id,exercises!inner(name)')
    .in('workout_id', workoutIds);
  if (workoutExercisesResult.error) throw workoutExercisesResult.error;

  const workoutExerciseRows = (workoutExercisesResult.data ?? []) as WorkoutExerciseRow[];
  const workoutExerciseMap = new Map<string, Set<string>>();
  for (const row of workoutExerciseRows) {
    const exerciseName = normalizeName(exerciseNameFromJoin(row.exercises));
    if (!exerciseName) continue;
    const current = workoutExerciseMap.get(row.workout_id) ?? new Set<string>();
    current.add(exerciseName);
    workoutExerciseMap.set(row.workout_id, current);
  }

  const workoutNameById = new Map<string, string>(
    candidateWorkouts.map((w) => [w.id, w.name] as const),
  );

  let updated = 0;
  let skipped = 0;

  for (const session of importSessions) {
    const liftSetResult = await supabase
      .from('lift_sets')
      .select('exercise_name')
      .eq('session_id', session.id);
    if (liftSetResult.error) throw liftSetResult.error;
    const sessionLiftSets = (liftSetResult.data ?? []) as LiftSetRow[];
    const sessionExercises = new Set<string>(
      sessionLiftSets
        .map((r) => normalizeName(String(r.exercise_name ?? '')))
        .filter((name) => name.length > 0),
    );

    if (sessionExercises.size === 0) {
      skipped += 1;
      console.log(`SKIPPED session=${session.id} reason=NO_LIFT_SETS`);
      continue;
    }

    const scored = candidateWorkouts
      .map((w) =>
        scoreWorkout(
          sessionExercises,
          workoutExerciseMap.get(w.id) ?? new Set<string>(),
          w.id,
          workoutNameById.get(w.id) ?? '',
        ),
      )
      .sort((a, b) => b.overlap - a.overlap || a.workoutName.localeCompare(b.workoutName));

    const best = scored[0];
    if (!best || best.overlap <= 0) {
      skipped += 1;
      console.log(`SKIPPED session=${session.id} reason=NO_OVERLAP`);
      continue;
    }

    const updateResult = await supabase
      .from('sessions')
      .update({ workout_id: best.workoutId })
      .eq('id', session.id);
    if (updateResult.error) throw updateResult.error;

    updated += 1;
    console.log(
      `REMAPPED session=${session.id} workout="${best.workoutName}" confidence=${best.overlap}`,
    );
  }

  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
}

main().catch((error) => {
  console.error('Remap failed:', error);
  process.exit(1);
});
