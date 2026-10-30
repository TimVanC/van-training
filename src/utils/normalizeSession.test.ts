import { describe, expect, it } from 'vitest';
import type { LiftSession, SessionExercise } from '../types/session';
import { collectExerciseNotes, normalizeSessionToRows } from './normalizeSession';

const exercise = (name: string, extra: Partial<SessionExercise> = {}): SessionExercise => ({
  name,
  targetSets: 3,
  targetRepRange: '8-12',
  sets: [{ weight: 100, reps: 10, rir: 1 }],
  completed: true,
  ...extra,
});

const session = (exercises: SessionExercise[], notes?: string): LiftSession => ({
  activityType: 'Lift',
  split: 'PPL/UL',
  day: 'Push',
  exercises,
  notes,
  startedAt: '2026-11-02T18:00:00.000Z',
});

describe('collectExerciseNotes', () => {
  it('keeps only exercises with a note, trimmed, under the name the sets were logged as', () => {
    const notes = collectExerciseNotes(
      session([
        exercise('Incline Dumbbell Press', { note: '  seat 4, felt strong  ' }),
        exercise('Flat Machine Chest Press', { activeName: 'Single arm pec deck', note: 'machine taken' }),
        exercise('Weighted Chest Dips'),
        exercise('Cable Lateral Raises', { note: '   ' }),
      ]),
    );
    expect(notes).toEqual([
      { exercise: 'Incline Dumbbell Press', note: 'seat 4, felt strong' },
      { exercise: 'Single arm pec deck', note: 'machine taken' },
    ]);
  });

  it('saves a note on a skipped exercise with no sets', () => {
    const notes = collectExerciseNotes(session([exercise('Hack Squat', { sets: [], note: 'out of order today' })]));
    expect(notes).toEqual([{ exercise: 'Hack Squat', note: 'out of order today' }]);
  });

  it('keeps the first note when two entries resolve to the same name', () => {
    const notes = collectExerciseNotes(
      session([exercise('Leg Press', { note: 'first' }), exercise('leg press', { note: 'second' })]),
    );
    expect(notes).toEqual([{ exercise: 'Leg Press', note: 'first' }]);
  });
});

describe('normalizeSessionToRows', () => {
  it('still puts the day note on every row and leaves exercise notes out of the rows', () => {
    const rows = normalizeSessionToRows(session([exercise('Leg Press', { note: 'per-exercise' })], 'day note'));
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe('day note');
    expect(rows[0]).not.toHaveProperty('exercise_note');
  });
});
