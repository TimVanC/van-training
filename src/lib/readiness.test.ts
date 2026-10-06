import { describe, expect, it } from 'vitest';
import type { AnalysisSessionRow, AnalysisSetRow, CheckinRow } from './analysis';
import { buildReadinessReport, computeSessionStrength } from './readiness';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-07-01T18:00:00Z').getTime();

function dateAt(day: number): string {
  return new Date(START + day * DAY_MS).toISOString();
}

interface Spec {
  day: number;
  weight: number;
  dayName?: string;
  exercise?: string;
  checkin?: Partial<Omit<CheckinRow, 'sessionDate'>>;
}

/** One session per spec, each with 3 sets of one lift at the given weight. */
function build(specs: Spec[]) {
  const sessions: AnalysisSessionRow[] = [];
  const sets: AnalysisSetRow[] = [];
  const checkins: CheckinRow[] = [];
  specs.forEach((spec, i) => {
    const id = `s${i}`;
    sessions.push({ id, date: dateAt(spec.day), dayName: spec.dayName ?? 'Push', splitName: 'PPL' });
    for (let k = 0; k < 3; k++) {
      sets.push({ sessionId: id, exerciseName: spec.exercise ?? 'Flat Dumbbell Press', weight: spec.weight, reps: 8, rir: 2 });
    }
    if (spec.checkin) {
      checkins.push({
        sessionDate: dateAt(spec.day).slice(0, 10),
        feel: null,
        effort: null,
        sleep: null,
        soreness: null,
        dietQuality: null,
        tookPreworkout: null,
        dayName: spec.dayName ?? 'Push',
        ...spec.checkin,
      });
    }
  });
  return { sessions, sets, checkins };
}

describe('computeSessionStrength', () => {
  it('scores a session against the lift average of the previous 4 weeks', () => {
    const { sessions, sets } = build([
      { day: 0, weight: 100 },
      { day: 7, weight: 100 },
      { day: 14, weight: 110 },
    ]);
    const scores = computeSessionStrength(sessions, sets);
    expect(scores.has('s0')).toBe(false); // nothing to compare with yet
    expect(scores.get('s1')).toBeCloseTo(0, 5);
    expect(scores.get('s2')).toBeCloseTo(10, 5);
  });

  it('widens to 8 weeks when the lift was not done in the last 4', () => {
    const { sessions, sets } = build([
      { day: 0, weight: 100 },
      { day: 40, weight: 90 },
    ]);
    expect(computeSessionStrength(sessions, sets).get('s1')).toBeCloseTo(-10, 5);
  });
});

describe('buildReadinessReport', () => {
  // Good-sleep days lift ~5% over baseline and are pushed harder; poor-sleep
  // days land ~5% under. Diet alternates independently so it should not matter.
  const specs: Spec[] = [{ day: 0, weight: 100 }];
  for (let i = 1; i <= 12; i++) {
    const goodSleep = i % 2 === 0;
    specs.push({
      day: i * 3,
      weight: goodSleep ? 105 : 95,
      checkin: {
        sleep: goodSleep ? 8 : 5,
        effort: goodSleep ? 8 : 6,
        feel: goodSleep ? 7 : 6,
        dietQuality: i % 3 === 0 ? 8 : 4,
        tookPreworkout: i % 4 === 0,
      },
    });
  }
  const data = build(specs);
  const report = buildReadinessReport(data.sessions, data.sets, data.checkins);

  it('finds the factor that moves strength and effort', () => {
    const sleep = report.factors.find((f) => f.factor === 'sleep')!;
    expect(sleep.status).toBe('ready');
    expect(sleep.highCount).toBe(6);
    expect(sleep.lowCount).toBe(6);
    const strength = sleep.effects.find((e) => e.outcome === 'strength')!;
    expect(strength.delta).toBeGreaterThan(5);
    expect(strength.notable).toBe(true);
    const effort = sleep.effects.find((e) => e.outcome === 'effort')!;
    expect(effort.high).toBe(8);
    expect(effort.low).toBe(6);
    expect(report.headline).toContain('sleep days');
  });

  it('does not credit a factor that made no difference', () => {
    const diet = report.factors.find((f) => f.factor === 'diet')!;
    const strength = diet.effects.find((e) => e.outcome === 'strength')!;
    expect(Math.abs(strength.delta)).toBeLessThan(2.5);
    expect(strength.notable).toBe(false);
  });

  it('reports the sample behind every bucket', () => {
    expect(report.checkins).toBe(12);
    expect(report.matched).toBe(12);
  });

  it('surfaces the combination of answers that goes with better workouts', () => {
    const better = report.combos.filter((c) => c.direction === 'better');
    expect(better.length).toBeGreaterThan(0);
    const top = better[0];
    expect(top.conditions.some((c) => c.factor === 'sleep' && c.state === 'high')).toBe(true);
    expect(top.strengthDelta ?? 0).toBeGreaterThan(0);
  });

  it('matches a check-in to the right session when a day has two workouts', () => {
    const two = build([
      { day: 0, weight: 100, dayName: 'Push' },
      { day: 0, weight: 50, dayName: 'Pull', exercise: 'Lat Pulldown' },
      { day: 7, weight: 100, dayName: 'Push' },
      { day: 7, weight: 40, dayName: 'Pull', exercise: 'Lat Pulldown', checkin: { sleep: 3 } },
    ]);
    // The Pull session on day 7 is 20% under its baseline; Push is flat.
    const r = buildReadinessReport(two.sessions, two.sets, two.checkins);
    expect(r.matched).toBe(1);
    const pullScore = computeSessionStrength(two.sessions, two.sets).get('s3');
    expect(pullScore).toBeCloseTo(-20, 5);
  });
});
