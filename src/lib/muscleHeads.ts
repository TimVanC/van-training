/**
 * Per-head training report: which region of each muscle group the logged
 * work actually hits (e.g. long vs lateral vs medial triceps head), with
 * compound lifts crediting every group they load (see ./muscles.ts).
 *
 * Pure module — shared by the Vercel API functions and the client.
 */

import {
  MUSCLE_GROUPS,
  MUSCLE_HEADS,
  classifyExercise,
  headEmphasis,
  type MuscleGroup,
} from './muscles.js';

// The anatomy tables live in ./muscles.ts; re-exported here so existing
// imports keep working.
export { MUSCLE_HEADS, headEmphasis };

export interface MuscleHeadShare {
  head: string;
  /** Share of this group's estimated head-stimulus, 0–100. */
  sharePct: number;
  /** Weighted working sets contributing to this head over the window. */
  weightedSets: number;
  /** Exercises contributing most to this head, strongest first. */
  topExercises: string[];
}

export interface MuscleHeadReport {
  group: MuscleGroup;
  /** Total working sets counted toward this group in the window. */
  totalSets: number;
  heads: MuscleHeadShare[];
}

interface HeadSetRow {
  sessionId: string;
  exerciseName: string;
}

interface HeadSessionRow {
  id: string;
  /** ISO timestamp. */
  date: string;
}

/**
 * Estimated per-head training share for each muscle group over the last
 * `windowDays`. Each set credits every group in the exercise's load profile
 * (1 for the primary mover, fractional for synergists — matching the
 * weekly-sets convention), spread across heads by `headEmphasis`.
 */
export function computeMuscleHeadReport(
  sessions: HeadSessionRow[],
  sets: HeadSetRow[],
  now: Date,
  windowDays = 56,
): MuscleHeadReport[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  type HeadAcc = { weighted: number; byExercise: Map<string, number> };
  const acc = new Map<MuscleGroup, { totalSets: number; heads: HeadAcc[] }>();
  for (const g of MUSCLE_GROUPS) {
    acc.set(g, { totalSets: 0, heads: MUSCLE_HEADS[g].map(() => ({ weighted: 0, byExercise: new Map() })) });
  }

  const addSet = (group: MuscleGroup, exerciseName: string, groupWeight: number): void => {
    const emphasis = headEmphasis(group, exerciseName);
    const groupAcc = acc.get(group)!;
    groupAcc.totalSets += groupWeight;
    emphasis.forEach((headWeight, i) => {
      if (headWeight <= 0) return;
      const contribution = groupWeight * headWeight;
      const head = groupAcc.heads[i];
      head.weighted += contribution;
      head.byExercise.set(exerciseName, (head.byExercise.get(exerciseName) ?? 0) + contribution);
    });
  };

  for (const set of sets) {
    const session = sessionById.get(set.sessionId);
    if (!session) continue;
    const t = new Date(session.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const cls = classifyExercise(set.exerciseName);
    if (!cls) continue;
    for (const [group, weight] of Object.entries(cls.load) as Array<[MuscleGroup, number]>) {
      if (weight > 0) addSet(group, set.exerciseName, weight);
    }
  }

  const reports: MuscleHeadReport[] = [];
  for (const group of MUSCLE_GROUPS) {
    const groupAcc = acc.get(group)!;
    if (groupAcc.totalSets <= 0) continue;
    const totalWeighted = groupAcc.heads.reduce((s, h) => s + h.weighted, 0);
    if (totalWeighted <= 0) continue;
    reports.push({
      group,
      totalSets: Number(groupAcc.totalSets.toFixed(1)),
      heads: MUSCLE_HEADS[group].map((head, i) => {
        const h = groupAcc.heads[i];
        return {
          head,
          sharePct: Math.round((h.weighted / totalWeighted) * 100),
          weightedSets: Number(h.weighted.toFixed(1)),
          topExercises: [...h.byExercise.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([name]) => name),
        };
      }),
    });
  }
  return reports;
}
