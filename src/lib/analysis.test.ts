import { describe, expect, it } from 'vitest';
import { summarizeMuscleGroups, type AnalysisSessionRow, type AnalysisSetRow } from './analysis';

const NOW = new Date('2026-10-06T12:00:00Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

/** One session on `date` with `count` working sets of a single-group exercise. */
function session(id: string, date: string, exerciseName: string, count: number) {
  const row: AnalysisSessionRow = { id, date, dayName: 'Pull', splitName: 'PPL' };
  const sets: AnalysisSetRow[] = Array.from({ length: count }, () => ({
    sessionId: id,
    exerciseName,
    weight: 30,
    reps: 10,
    rir: 2,
  }));
  return { row, sets };
}

describe('summarizeMuscleGroups rolling 4-week set totals', () => {
  it('splits sets into the last 28 days and the 28 days before', () => {
    const parts = [
      session('a', daysAgo(2), 'Hammer Curl', 4), // last 4 weeks
      session('b', daysAgo(27), 'Hammer Curl', 3), // still inside the last 28 days
      session('c', daysAgo(29), 'Hammer Curl', 5), // prior window
      session('d', daysAgo(55), 'Hammer Curl', 2), // prior window, near its edge
      session('e', daysAgo(70), 'Hammer Curl', 9), // older than 8 weeks: ignored
    ];
    const summaries = summarizeMuscleGroups(
      parts.map((p) => p.row),
      parts.flatMap((p) => p.sets),
      NOW,
    );
    const biceps = summaries.find((s) => s.name === 'Biceps');
    expect(biceps).toBeDefined();
    expect(biceps!.setsLast4Weeks).toBe(7);
    expect(biceps!.setsPrior4Weeks).toBe(7);
  });

  it('is not affected by the current ISO week being partial', () => {
    // A Monday just after midnight: the current ISO week has no sets, but
    // the rolling window still sees everything from the last 28 days.
    const monday = new Date('2026-10-05T00:30:00Z');
    const parts = [session('a', '2026-10-01T18:00:00Z', 'Standing Calf Raise', 6)];
    const summaries = summarizeMuscleGroups(
      parts.map((p) => p.row),
      parts.flatMap((p) => p.sets),
      monday,
    );
    const calves = summaries.find((s) => s.name === 'Calves')!;
    expect(calves.weeklySets.at(-1)!.sets).toBe(0);
    expect(calves.setsLast4Weeks).toBe(6);
    expect(calves.setsPrior4Weeks).toBe(0);
  });
});

describe('summarizeMuscleGroups verdict readiness', () => {
  const run = (parts: ReturnType<typeof session>[]) =>
    summarizeMuscleGroups(
      parts.map((p) => p.row),
      parts.flatMap((p) => p.sets),
      NOW,
    );

  it('reports what was logged while a group is still early', () => {
    const summaries = run([
      session('a', daysAgo(7), 'Lat Pulldown', 4),
      session('b', daysAgo(3), 'Seated Cable Row', 3),
    ]);
    const back = summaries.find((s) => s.name === 'Back')!;
    expect(back.verdict).toBe('insufficient');
    expect(back.sessionsInWindow).toBe(2);
    expect(back.liftsInWindow).toBe(2);
  });

  it('gives a verdict once lifts repeat and the group has 3 sessions', () => {
    // Two lifts logged twice each: no single lift has 3 sessions, but the
    // group does, and each lift can be compared against itself.
    const summaries = run([
      session('a', daysAgo(21), 'Lat Pulldown', 4),
      session('b', daysAgo(14), 'Seated Cable Row', 3),
      session('c', daysAgo(7), 'Lat Pulldown', 4),
      session('d', daysAgo(1), 'Seated Cable Row', 3),
    ]);
    const back = summaries.find((s) => s.name === 'Back')!;
    expect(back.verdict).not.toBe('insufficient');
    expect(back.exercises.map((e) => e.sessions)).toEqual([2, 2]);
  });

  it('merges name drift onto one lift and shows the latest name', () => {
    const summaries = run([
      session('a', daysAgo(20), 'DB Bench Press', 3),
      session('b', daysAgo(10), 'DB Bench Press', 3),
      session('c', daysAgo(2), 'Flat Dumbbell Press', 3),
    ]);
    const chest = summaries.find((s) => s.name === 'Chest')!;
    expect(chest.exercises).toHaveLength(1);
    expect(chest.exercises[0].name).toBe('Flat Dumbbell Press');
    expect(chest.exercises[0].sessions).toBe(3);
    expect(chest.verdict).not.toBe('insufficient');
  });
});
