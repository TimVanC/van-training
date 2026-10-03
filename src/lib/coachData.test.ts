import { describe, expect, it } from 'vitest';
import {
  estimatedOneRepMax,
  exerciseHistory,
  listExercises,
  matchExercise,
  muscleSummary,
  personalRecords,
  recentSessions,
  weeklySummary,
  type CoachSetRow,
} from './coachData';
import { sanitizeChart, MAX_CHART_POINTS } from './coachChart';

let n = 0;
function set(sessionId: string, date: string, exercise: string, weight: number, reps: number, dayName = 'Push A'): CoachSetRow {
  n += 1;
  return { sessionId, date, splitName: 'PPL', dayName, exercise, weight, reps, setNumber: n };
}

// Three sessions over three weeks. Wed 2026-09-30 is "now".
const NOW = new Date('2026-09-30T15:00:00Z');
const rows: CoachSetRow[] = [
  set('s1', '2026-09-14T22:00:00Z', 'Flat Dumbbell Press', 80, 8),
  set('s1', '2026-09-14T22:00:00Z', 'Flat Dumbbell Press', 75, 9),
  set('s1', '2026-09-14T22:00:00Z', 'Triceps Pushdowns', 50, 12),
  set('s2', '2026-09-21T22:00:00Z', 'Flat Dumbbell Press', 85, 6),
  set('s2', '2026-09-21T22:00:00Z', 'Flat Dumbbell Press', 80, 8),
  set('s2', '2026-09-21T22:00:00Z', 'Lat Pulldown', 140, 10, 'Pull A'),
  set('s3', '2026-09-29T22:00:00Z', 'Flat Dumbbell Press', 85, 8),
  set('s3', '2026-09-29T22:00:00Z', 'Neutral Grip Pull-Ups', -40, 8, 'Pull A'),
];

describe('coachData', () => {
  it('estimates 1RM and ignores non-positive loads', () => {
    expect(estimatedOneRepMax(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimatedOneRepMax(100, 40)).toBeCloseTo(estimatedOneRepMax(100, 20));
    expect(estimatedOneRepMax(-40, 8)).toBe(0);
    expect(estimatedOneRepMax(100, 0)).toBe(0);
  });

  it('lists exercises newest first with counts and best set', () => {
    const list = listExercises(rows);
    expect(list.map((e) => e.exercise).slice(0, 2).sort()).toEqual(['Flat Dumbbell Press', 'Neutral Grip Pull-Ups']);
    const press = list.find((e) => e.exercise === 'Flat Dumbbell Press')!;
    expect(press).toMatchObject({ sessions: 3, sets: 5, firstDate: '2026-09-14', lastDate: '2026-09-29', bestSet: '85x8' });
    expect(listExercises([])).toEqual([]);
  });

  it('matches exercise names loosely', () => {
    expect(matchExercise(rows, 'flat dumbbell press')).toBe('Flat Dumbbell Press');
    expect(matchExercise(rows, 'pulldown')).toBe('Lat Pulldown');
    expect(matchExercise(rows, 'tricep pushdown')).toBe('Triceps Pushdowns');
    expect(matchExercise(rows, 'pull ups')).toBe('Neutral Grip Pull-Ups');
    expect(matchExercise(rows, 'deadlift')).toBeNull();
    expect(matchExercise(rows, '  ')).toBeNull();
  });

  it('builds per-session history oldest first and honours the limit', () => {
    const history = exerciseHistory(rows, 'dumbbell press', 2);
    expect(history.exercise).toBe('Flat Dumbbell Press');
    expect(history.totalSessions).toBe(3);
    expect(history.sessions.map((s) => s.date)).toEqual(['2026-09-21', '2026-09-29']);
    expect(history.sessions[0]).toMatchObject({ sets: '85x6, 80x8', topWeight: 85, topReps: 6, volume: 85 * 6 + 80 * 8 });
    expect(exerciseHistory(rows, 'squat', 5)).toEqual({ exercise: null, totalSessions: 0, sessions: [] });
  });

  it('returns recent sessions newest first, grouped by exercise', () => {
    const sessions = recentSessions(rows, 2);
    expect(sessions.map((s) => s.date)).toEqual(['2026-09-29', '2026-09-21']);
    expect(sessions[1].exercises).toEqual([
      { name: 'Flat Dumbbell Press', sets: '85x6, 80x8' },
      { name: 'Lat Pulldown', sets: '140x10' },
    ]);
  });

  it('summarizes weeks including empty ones, and never counts assistance as negative volume', () => {
    const weeks = weeklySummary(rows, 4, NOW);
    expect(weeks.map((w) => w.weekOf)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(weeks.map((w) => w.sessions)).toEqual([0, 1, 1, 1]);
    expect(weeks[0]).toMatchObject({ sets: 0, volume: 0 });
    expect(weeks[3]).toMatchObject({ sets: 2, volume: 85 * 8 });
  });

  it('counts sets per muscle group inside the window only', () => {
    const twoWeeks = muscleSummary(rows, 2, NOW);
    const chest = twoWeeks.find((m) => m.group === 'Chest')!;
    const back = twoWeeks.find((m) => m.group === 'Back')!;
    const triceps = twoWeeks.find((m) => m.group === 'Triceps')!;
    expect(chest).toMatchObject({ sets: 3, setsPerWeek: 1.5, topExercises: ['Flat Dumbbell Press'] });
    expect(back.sets).toBe(2);
    expect(triceps.sets).toBe(0);
  });

  it('finds personal records and whether they are current', () => {
    const records = personalRecords(rows);
    expect(records[0]).toMatchObject({ exercise: 'Lat Pulldown', bestSet: '140x10', isLatestSession: true });
    const press = records.find((r) => r.exercise === 'Flat Dumbbell Press')!;
    expect(press).toMatchObject({ bestSet: '85x8', date: '2026-09-29', isLatestSession: true });
    expect(records.some((r) => r.exercise === 'Neutral Grip Pull-Ups')).toBe(false);
  });
});

describe('sanitizeChart', () => {
  const base = { type: 'line', title: 'Bench', yLabel: 'lb', labels: ['Sep 1', 'Sep 8'], series: [{ name: 'e1RM', values: [200, 205] }] };

  it('accepts a valid chart', () => {
    expect(sanitizeChart(base)).toEqual({ chart: base });
  });

  it('nulls out non-numeric points and fills in missing names', () => {
    const result = sanitizeChart({ type: 'bar', labels: ['a', 2], series: [{ values: [1, 'x'] }] });
    expect(result).toEqual({
      chart: { type: 'bar', title: 'Chart', yLabel: '', labels: ['a', '2'], series: [{ name: 'Series 1', values: [1, null] }] },
    });
  });

  it('rejects specs it cannot draw', () => {
    const errorOf = (input: unknown) => (sanitizeChart(input) as { error: string }).error;
    expect(errorOf(null)).toBeTruthy();
    expect(errorOf({ ...base, type: 'pie' })).toMatch(/type/);
    expect(errorOf({ ...base, labels: [] })).toMatch(/labels/);
    expect(errorOf({ ...base, labels: Array(MAX_CHART_POINTS + 1).fill('x') })).toMatch(/At most/);
    expect(errorOf({ ...base, series: [] })).toMatch(/series/);
    expect(errorOf({ ...base, series: [{ name: 'a', values: [1] }] })).toMatch(/one value per label/);
    expect(errorOf({ ...base, series: [{ name: 'a', values: [null, null] }] })).toMatch(/no numeric/);
    expect(errorOf({ ...base, series: Array(5).fill(base.series[0]) })).toMatch(/At most/);
  });
});
