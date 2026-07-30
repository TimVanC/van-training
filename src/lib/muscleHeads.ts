/**
 * Per-head training emphasis: which region of each muscle group the logged
 * work actually hits (e.g. long vs lateral vs medial triceps head).
 *
 * Exercise names are free text, so mapping is keyword-based like
 * `classifyExercise` — deliberately tolerant, most-specific rules first.
 * Weights are relative emphasis (0–1) informed by standard EMG/biomechanics
 * heuristics; they are estimates for training-balance feedback, not clinical
 * measurements.
 *
 * Pure module — shared by the Vercel API functions and the client.
 */

import { MUSCLE_GROUPS, classifyExercise, type MuscleGroup } from './muscles.js';

export const MUSCLE_HEADS: Record<MuscleGroup, string[]> = {
  Chest: ['Upper Chest', 'Mid Chest', 'Lower Chest'],
  Back: ['Lats', 'Upper Traps', 'Mid-Back', 'Lower Back'],
  Shoulders: ['Front Delt', 'Side Delt', 'Rear Delt'],
  Biceps: ['Long (Outer) Head', 'Short (Inner) Head', 'Brachialis'],
  Triceps: ['Long Head', 'Lateral Head', 'Medial Head'],
  Quads: ['Rectus Femoris', 'Outer Quad (VL)', 'Inner Quad (VMO)'],
  Hamstrings: ['Biceps Femoris (Outer)', 'Semis (Inner)', 'Glutes (hinge assist)'],
  Calves: ['Gastrocnemius', 'Soleus'],
  Core: ['Upper Abs', 'Lower Abs', 'Obliques', 'Serratus'],
};

/** Relative emphasis of `exerciseName` across `group`'s heads. */
export function headEmphasis(group: MuscleGroup, exerciseName: string): number[] {
  const n = exerciseName.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  // Returns weights aligned with MUSCLE_HEADS[group] order.
  switch (group) {
    case 'Chest': {
      if (has('incline', 'low to high', 'low-to-high')) return [1, 0.4, 0];
      if (has('decline', 'high to low', 'high-to-low', 'dip')) return [0, 0.4, 1];
      if (has('fly', 'pec')) return [0.2, 1, 0.2];
      if (has('push-up', 'push up', 'pushup')) return [0.2, 1, 0.4];
      if (has('flat', 'bench', 'press')) return [0.3, 1, 0.3];
      return [0.33, 0.34, 0.33];
    }
    case 'Back': {
      if (has('shrug')) return [0, 1, 0.2, 0];
      if (has('extension', 'hyper', 'good morning')) return [0, 0.2, 0.2, 1];
      if (has('deadlift')) return [0.2, 0.4, 0.3, 1];
      if (has('row')) return [0.5, 0.2, 1, 0.1];
      if (has('pulldown', 'pull down', 'pull-up', 'pull up', 'chin', 'pullover', 'straight arm', /* word */ 'lat ')) return [1, 0, 0.3, 0];
      return [0.4, 0.2, 0.3, 0.1];
    }
    case 'Shoulders': {
      if (has('rear', 'reverse', 'face pull')) return [0, 0, 1];
      if (has('lateral', 'lean-away', 'lean away', 'upright')) return [0, 1, 0];
      if (has('front raise')) return [1, 0.2, 0];
      if (has('press', 'arnold', 'overhead')) return [1, 0.3, 0];
      return [0.33, 0.34, 0.33];
    }
    case 'Biceps': {
      if (has('hammer', 'reverse', 'rope')) return [0.4, 0, 1];
      if (has('incline', 'bayesian', 'drag', 'behind')) return [1, 0.4, 0.1];
      if (has('preacher', 'spider', 'concentration')) return [0.4, 1, 0.1];
      if (has('curl')) return [0.7, 0.7, 0.3];
      return [0.5, 0.4, 0.4];
    }
    case 'Triceps': {
      if (has('overhead', 'skull', 'french')) return [1, 0.3, 0.4];
      if (has('pushdown', 'push down', 'pressdown', 'kickback')) return [0.2, 1, 0.6];
      if (has('dip', 'close grip', 'bench', 'press')) return [0.2, 0.6, 0.8];
      return [0.5, 0.5, 0.5];
    }
    case 'Quads': {
      if (has('extension', 'sissy')) return [1, 0.6, 0.6];
      if (has('lunge', 'bulgarian', 'split')) return [0.4, 0.8, 1];
      if (has('squat', 'sqaut', 'press', 'hack', 'pendulum')) return [0.4, 1, 0.8];
      return [0.5, 0.7, 0.6];
    }
    case 'Hamstrings': {
      if (has('seated')) return [0.7, 1, 0];
      if (has('curl', 'nordic')) return [1, 0.8, 0];
      if (has('rdl', 'romanian', 'deadlift', 'good morning', 'hyper', 'extension')) return [0.8, 0.8, 1];
      if (has('squat', 'press', 'lunge', 'bulgarian')) return [0.5, 0.4, 0.8];
      return [0.6, 0.6, 0.4];
    }
    case 'Calves': {
      if (has('seated')) return [0.3, 1];
      return [1, 0.4];
    }
    case 'Core': {
      if (has('serratus')) return [0, 0, 0, 1];
      if (has('woodchop', 'rotation', 'pallof', 'oblique', 'side bend', 'twist')) return [0, 0, 1, 0.2];
      if (has('knee raise', 'leg raise', 'reverse crunch', 'chair raise')) return [0.3, 1, 0, 0];
      if (has('rollout', 'plank', 'body saw')) return [0.7, 0.7, 0.1, 0.3];
      if (has('crunch', 'situp', 'sit-up')) return [1, 0.3, 0, 0];
      return [0.4, 0.4, 0.1, 0.1];
    }
  }
}

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
 * `windowDays`. Sets count 1 toward the exercise's primary group and 0.5
 * toward secondaries (matching the weekly-sets convention), spread across
 * heads by `headEmphasis`.
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
    addSet(cls.primary, set.exerciseName, 1);
    for (const secondary of cls.secondary) addSet(secondary, set.exerciseName, 0.5);
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
