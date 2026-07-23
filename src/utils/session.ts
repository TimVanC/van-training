import type { Exercise } from '../types/lift';
import type { LiftSession, SessionExercise } from '../types/session';

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
      targetRepRange: ex.repRange,
      inputMode: ex.inputMode ?? 'weight',
      sets: [],
      completed: false,
    })),
    startedAt: new Date().toISOString(),
  };
}

/**
 * Reconciles an in-progress session with the day's current template, so a
 * template change (exercise added/removed, targets adjusted) shows up on
 * refresh without discarding anything already logged.
 *
 * - Exercises are matched by base `name` (swap substitutions live in
 *   `activeName` and are preserved).
 * - Matched exercises keep their logged sets, completed flag, and — once any
 *   set has been logged — their input mode; targets follow the template.
 * - Exercises no longer in the template are dropped unless they have logged
 *   sets, in which case they are kept at the end so no data is lost.
 * - Returns the original session object when nothing changed.
 */
export function mergeLiftSessionWithTemplate(
  session: LiftSession,
  template: Exercise[],
): LiftSession {
  const byName = new Map(session.exercises.map((ex) => [ex.name, ex]));
  const templateNames = new Set(template.map((t) => t.exercise));

  const merged: SessionExercise[] = template.map((t) => {
    const existing = byName.get(t.exercise);
    if (!existing) {
      return {
        name: t.exercise,
        targetSets: t.sets,
        targetRepRange: t.repRange,
        inputMode: t.inputMode ?? 'weight',
        sets: [],
        completed: false,
      };
    }
    const inputMode =
      existing.sets.length > 0
        ? (existing.inputMode ?? 'weight')
        : (t.inputMode ?? 'weight');
    if (
      existing.targetSets === t.sets &&
      existing.targetRepRange === t.repRange &&
      (existing.inputMode ?? 'weight') === inputMode
    ) {
      return existing;
    }
    return { ...existing, targetSets: t.sets, targetRepRange: t.repRange, inputMode };
  });

  const extras = session.exercises.filter(
    (ex) => !templateNames.has(ex.name) && ex.sets.length > 0,
  );
  const next = [...merged, ...extras];

  const unchanged =
    next.length === session.exercises.length &&
    next.every((ex, i) => ex === session.exercises[i]);
  return unchanged ? session : { ...session, exercises: next };
}
