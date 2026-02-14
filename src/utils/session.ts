import type { Exercise } from '../types/lift';
import type { LiftSession } from '../types/session';

export function createLiftSession(
  split: string,
  day: string,
  exercises: Exercise[],
): LiftSession {
  return {
    activityType: 'Lift',
    split,
    day,
    exercises: exercises.map((ex) => ({
      name: ex.exercise,
      targetSets: ex.sets,
      targetReps: ex.reps,
      sets: [],
      completed: false,
    })),
    startedAt: new Date().toISOString(),
  };
}
