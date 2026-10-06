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
