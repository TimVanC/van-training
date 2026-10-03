import { describe, expect, it } from 'vitest';
import { canonicalLiftKey, computePeakReport, type PeakSetRow } from './peak';

function row(exerciseName: string, date: string, weight: number, reps: number, sessionKey = date): PeakSetRow {
  return { sessionKey, date, dateEstimated: false, splitName: 'PPLs', splitAbbr: 'PPL', exerciseName, weight, reps, source: 'app' };
}

const NOW = new Date('2026-10-01T12:00:00Z');
const liftsOf = (rows: PeakSetRow[]) => computePeakReport(rows, NOW).groups.flatMap((g) => g.lifts);

describe('canonicalLiftKey', () => {
  it('merges name drift onto one lineage', () => {
    expect(canonicalLiftKey('DB Bench Press')).toBe('flat-db-press');
    expect(canonicalLiftKey('Flat Dumbbell Press')).toBe('flat-db-press');
    expect(canonicalLiftKey('Single Arm Pec Dec')).toBe('single-arm-pec-deck');
    expect(canonicalLiftKey('Jump Rope')).toBeNull();
  });
});

describe('computePeakReport', () => {
  it('scores exercises outside the curated lineages under their own name', () => {
    const lifts = liftsOf([row('Barbell Back Squat', '2026-09-28', 225, 5), row('Ab Wheel Rollouts', '2026-09-28', 25, 10)]);
    expect(lifts.map((l) => l.label).sort()).toEqual(['Ab Wheel Rollouts', 'Barbell Back Squat']);
    expect(lifts.find((l) => l.label === 'Barbell Back Squat')!.group).toBe('Quads');
  });

  it('skips unscored and unclassifiable names', () => {
    expect(liftsOf([row('Jump Rope', '2026-09-28', 10, 100), row('Zzz Unknown Thing', '2026-09-28', 50, 10)])).toEqual([]);
  });

  it('compares the latest session with the all-time best', () => {
    const [lift] = liftsOf([
      row('Leg Press', '2026-08-01', 400, 10),
      row('Leg Press', '2026-09-28', 360, 10),
    ]);
    expect(lift.peak).toMatchObject({ weight: 400, reps: 10, date: '2026-08-01' });
    expect(lift.current).toMatchObject({ weight: 360, date: '2026-09-28' });
    expect(lift.pctOfPeak).toBe(90);
    expect(lift.atPeak).toBe(false);
    expect(lift.stale).toBe(false);
  });

  it('marks a lift untrained for three weeks as resting and keeps it out of the roll-up', () => {
    const report = computePeakReport([row('Leg Press', '2026-08-01', 400, 10)], NOW);
    expect(report.groups[0].lifts[0].stale).toBe(true);
    expect(report.groups[0].pctOfPeak).toBeNull();
    expect(report.overallPctOfPeak).toBeNull();
    expect(report.totalLifts).toBe(1);
  });

  it('returns an empty report for a lifter with no sets', () => {
    expect(computePeakReport([], NOW)).toMatchObject({ totalLifts: 0, groups: [], firstDate: null, overallPctOfPeak: null });
  });
});
