import { describe, expect, it } from 'vitest';
import { buildProgressionPlan, type PerformedSet } from './progression';
import {
  fatigueAdjusted,
  fatigueByOccurrence,
  MEANINGFUL_ALLOWANCE,
  muscleOverlap,
  upstreamFatigue,
  type ExerciseLog,
} from './fatigue';

const s = (weight: number, reps: number, rir = 0): PerformedSet => ({ weight, reps, rir });
const log = (exerciseName: string, sets: PerformedSet[]): ExerciseLog => ({ exerciseName, sets });

describe('buildProgressionPlan realism', () => {
  it('does not promote a fatigued second set the top set cannot carry', () => {
    const plan = buildProgressionPlan({
      exerciseName: 'Seated Dumbbell Shoulder Press',
      history: [[s(60, 6), s(55, 10), s(55, 8)]],
      repRange: { min: 6, max: 10 },
      targetSets: 3,
    })!;
    expect(plan.phase).toBe('build');
    expect(plan.sets.map((x) => [x.weight, x.targetReps, x.targetRIR])).toEqual([
      [60, 7, 0],
      [55, 10, 0],
      [55, 8, 0],
    ]);
  });

  it('promotes the next set once the top set has a cushion', () => {
    const plan = buildProgressionPlan({
      exerciseName: 'Seated Dumbbell Shoulder Press',
      history: [[s(60, 9), s(55, 10), s(55, 8)]],
      repRange: { min: 6, max: 10 },
      targetSets: 3,
    })!;
    expect(plan.phase).toBe('ladder');
    expect(plan.sets.map((x) => x.weight)).toEqual([60, 60, 55]);
  });

  it('matches the logged RIR instead of a fixed 1', () => {
    const plan = buildProgressionPlan({
      exerciseName: 'Seated Cable Row',
      history: [[s(121, 10, 2), s(121, 10, 1), s(121, 10, 0), s(121, 10, 0)]],
      repRange: { min: 8, max: 12 },
      targetSets: 4,
    })!;
    expect(plan.sets.every((x) => x.targetRIR === 1)).toBe(true);
  });

  it('gates a fresh jump that projects under the rep floor', () => {
    const plan = buildProgressionPlan({
      exerciseName: 'Chest Press Machine',
      history: [[s(100, 8), s(100, 8), s(100, 8)]],
      repRange: { min: 8, max: 12 },
      targetSets: 3,
    })!;
    expect(plan.phase).toBe('build');
    expect(plan.sets[0]).toMatchObject({ weight: 100, targetReps: 9 });
  });

  it('trims targets when today’s upstream work went up', () => {
    const plan = buildProgressionPlan({
      exerciseName: 'Overhead Cable Triceps Extension',
      history: [[s(27, 10), s(22, 12), s(22, 10, 1)]],
      repRange: { min: 10, max: 15 },
      targetSets: 3,
      todayFatigue: { allowance: 0.06, drivers: [{ exerciseName: 'Incline Dumbbell Press', change: 0.13, contribution: 0.06 }] },
    })!;
    expect(plan.rationale).toMatch(/Incline Dumbbell Press went up earlier today/);
    expect(plan.sets[0].targetReps).toBeLessThanOrEqual(10);
  });

  it('does not deload when the drops are explained by upstream fatigue', () => {
    const history = [[s(22, 9)], [s(22, 10)], [s(22, 11)], [s(22, 12)]];
    const base = { exerciseName: 'Overhead Cable Triceps Extension', history, repRange: { min: 10, max: 15 }, targetSets: 1 };
    expect(buildProgressionPlan(base)!.phase).toBe('deload');
    expect(buildProgressionPlan({ ...base, historyFatigue: [0.06, 0.06, 0.06] })!.phase).not.toBe('deload');
  });
});

describe('fatigue', () => {
  it('credits press triceps work against an extension', () => {
    expect(muscleOverlap('Incline Dumbbell Press', 'Overhead Cable Triceps Extension')).toBeCloseTo(0.5);
    expect(muscleOverlap('Leg Press', 'Overhead Cable Triceps Extension')).toBe(0);
  });

  it('only carries shoulder and back fatigue between matching heads', () => {
    // Front-delt pressing barely tires side or rear delts...
    expect(muscleOverlap('Incline Dumbbell Press', 'Cable Lateral Raises')).toBeLessThan(0.2);
    expect(muscleOverlap('Incline Dumbbell Press', 'Single Arm Rear Delt Cable Fly')).toBeLessThan(0.05);
    // ...but does tire the front delts a shoulder press uses.
    expect(muscleOverlap('Incline Dumbbell Press', 'Seated Dumbbell Shoulder Press')).toBeGreaterThan(0.45);
    // Lower-back and trap work doesn't tire the lats.
    expect(muscleOverlap('Romanian Deadlift', 'Lat Pulldown')).toBeLessThan(0.1);
    expect(muscleOverlap('Dumbbell Shrugs', 'Lat Pulldown')).toBeLessThan(0.1);
    expect(muscleOverlap('Seated Cable Row', 'Lat Pulldown')).toBeGreaterThan(0.5);
  });

  it('turns a heavier upstream press into an allowance', () => {
    const report = upstreamFatigue(
      'Overhead Cable Triceps Extension',
      [log('Incline Dumbbell Press', [s(85, 8), s(85, 8), s(85, 7), s(85, 6)])],
      [log('Incline Dumbbell Press', [s(75, 8), s(75, 8), s(75, 7), s(75, 6)])],
    );
    expect(report.allowance).toBeGreaterThan(MEANINGFUL_ALLOWANCE);
    expect(report.allowance).toBeLessThan(0.04);
    expect(report.drivers[0].exerciseName).toBe('Incline Dumbbell Press');
  });

  it('excuses explained drops without rewarding them', () => {
    expect(fatigueAdjusted(95, 100, 0.06)).toBe(100);
    expect(fatigueAdjusted(90, 100, 0.06)).toBeCloseTo(95.74, 1);
    expect(fatigueAdjusted(105, 100, 0.06)).toBe(105);
  });

  it('compares each occurrence with the previous one', () => {
    const map = fatigueByOccurrence([
      { id: 'a', date: '2026-10-01', exercises: [log('Incline Dumbbell Press', [s(75, 8)]), log('Overhead Cable Triceps Extension', [s(27, 10)])] },
      { id: 'b', date: '2026-10-08', exercises: [log('Incline Dumbbell Press', [s(85, 8)]), log('Overhead Cable Triceps Extension', [s(27, 9)])] },
    ]);
    expect(map.get('a')?.size).toBe(0);
    expect(map.get('b')?.get('overhead cable triceps extension')).toBeGreaterThan(0);
  });
});
