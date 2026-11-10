/**
 * Cross-exercise fatigue.
 *
 * An exercise isn't trained fresh: everything done before it in the session
 * has already worked some of the same muscles (an incline press loads the
 * triceps before an overhead extension). What matters for judging a session
 * is the *change* in that pre-fatigue versus the last time the exercise was
 * trained — if the upstream press jumped, the extension is expected to dip,
 * and holding steady is a win rather than a stall.
 *
 * The output is an "allowance": the fraction of strength (e1RM) a drop can
 * be explained by. Muscle overlap comes from the credit table in muscles.ts.
 * The sensitivity constants are estimates, not measurements — tune them
 * against logged history.
 *
 * Pure module — shared by the Vercel API functions and the client.
 */

import { defaultHeadEmphasis, exerciseProfile, type MuscleGroup } from './muscles.js';
import type { PerformedSet } from './progression.js';

export interface ExerciseLog {
  exerciseName: string;
  sets: PerformedSet[];
}

/** A session's exercises in the order they were performed. */
export interface OrderedSessionLog {
  id: string;
  date: string;
  exercises: ExerciseLog[];
}

export interface FatigueDriver {
  exerciseName: string;
  /** Relative workload change vs last time (0.13 = 13% more work). */
  change: number;
  /** Share of the allowance this exercise accounts for. */
  contribution: number;
}

export interface FatigueReport {
  /** Fraction of e1RM a drop can be explained by (0 .. MAX_ALLOWANCE). */
  allowance: number;
  /** Upstream exercises that added fatigue, strongest first. */
  drivers: FatigueDriver[];
}

/**
 * e1RM cost when fully-overlapping upstream work doubles. Scaled by the square
 * root of the change, so a 13% heavier press still registers while a whole
 * new press before triceps costs ~2 reps on a 10-rep set, not 5.
 */
const SENSITIVITY = 0.15;
/** Never excuse more than this much of a drop with upstream fatigue. */
export const MAX_ALLOWANCE = 0.06;
/** Below this, upstream changes are noise and don't change any judgment. */
export const MEANINGFUL_ALLOWANCE = 0.02;

const NO_FATIGUE: FatigueReport = { allowance: 0, drivers: [] };

function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Share of the target's muscle load that the upstream exercise also loads
 * (0..1). Overhead extension after an incline press -> ~0.5, since the press
 * credits triceps at 0.5 and the extension is all triceps.
 */
export function muscleOverlap(upstreamName: string, targetName: string): number {
  if (key(upstreamName) === key(targetName)) return 0;
  const upProfile = exerciseProfile(upstreamName);
  const targetProfile = exerciseProfile(targetName);
  if (!upProfile || !targetProfile) return 0;
  const up = upProfile.load;
  const entries = Object.entries(targetProfile.load) as Array<[MuscleGroup, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return 0;
  return entries.reduce((s, [g, w]) => {
    const shared = Math.min(1, up[g] ?? 0);
    if (shared <= 0) return s;
    const similarity = HEAD_SPECIFIC_GROUPS.has(g)
      ? headSimilarity(
          upProfile.heads[g] ?? defaultHeadEmphasis(g),
          targetProfile.heads[g] ?? defaultHeadEmphasis(g),
        )
      : 1;
    return s + (w / total) * shared * similarity;
  }, 0);
}

/**
 * Groups whose heads do different jobs, so fatigue only carries over between
 * exercises that hit the same heads: a front-delt press barely tires the side
 * delts, an RDL's lower-back work doesn't tire the lats. Heads of the other
 * groups share one joint action (every triceps head extends the elbow), so
 * fatigue there carries across heads.
 */
const HEAD_SPECIFIC_GROUPS = new Set<MuscleGroup>(['Shoulders', 'Back']);

/** Cosine similarity of two head-emphasis vectors (0..1). */
function headSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Comparable work for one exercise in one session. Tonnage for loaded work;
 * plain reps when the logged weight is bodyweight or assistance (<= 0), since
 * the ratio between sessions of the same exercise is all that's used.
 */
function workload(sets: PerformedSet[]): number {
  return sets.reduce((s, x) => s + (x.weight > 0 ? x.weight * x.reps : x.reps), 0);
}

/**
 * Extra fatigue the target carries from `currentUpstream` compared with
 * `previousUpstream` (what preceded it the last time it was trained).
 * Upstream work that went down offsets work that went up.
 */
export function upstreamFatigue(
  targetName: string,
  currentUpstream: ExerciseLog[],
  previousUpstream: ExerciseLog[],
): FatigueReport {
  const prevByKey = new Map(previousUpstream.map((e) => [key(e.exerciseName), e]));
  const curKeys = new Set(currentUpstream.map((e) => key(e.exerciseName)));

  let total = 0;
  const drivers: FatigueDriver[] = [];
  for (const cur of currentUpstream) {
    const overlap = muscleOverlap(cur.exerciseName, targetName);
    if (overlap <= 0) continue;
    const prev = prevByKey.get(key(cur.exerciseName));
    const curWork = workload(cur.sets);
    const prevWork = prev ? workload(prev.sets) : 0;
    // New upstream work counts as doubling it; cap any single change there.
    const change = prevWork > 0 ? Math.min(1, curWork / prevWork - 1) : curWork > 0 ? 1 : 0;
    const contribution = overlap * Math.sign(change) * Math.sqrt(Math.abs(change)) * SENSITIVITY;
    total += contribution;
    if (contribution > 0) drivers.push({ exerciseName: cur.exerciseName, change, contribution });
  }
  // Upstream work that was dropped entirely leaves the target fresher.
  for (const prev of previousUpstream) {
    if (curKeys.has(key(prev.exerciseName))) continue;
    total -= muscleOverlap(prev.exerciseName, targetName) * SENSITIVITY;
  }

  const allowance = Math.max(0, Math.min(MAX_ALLOWANCE, total));
  if (allowance <= 0) return NO_FATIGUE;
  drivers.sort((a, b) => b.contribution - a.contribution);
  return { allowance, drivers };
}

/** Exercises performed before `targetName` in a session, or null if it wasn't trained. */
export function upstreamOf(session: OrderedSessionLog, targetName: string): ExerciseLog[] | null {
  const idx = session.exercises.findIndex((e) => key(e.exerciseName) === key(targetName));
  return idx < 0 ? null : session.exercises.slice(0, idx);
}

/**
 * For every exercise occurrence, the upstream-fatigue allowance versus the
 * previous session that contained that exercise. Sessions must be sorted
 * oldest first. Returns sessionId -> lowercased exercise name -> allowance.
 */
export function fatigueByOccurrence(sessions: OrderedSessionLog[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const lastUpstream = new Map<string, ExerciseLog[]>();
  for (const session of sessions) {
    const perExercise = new Map<string, number>();
    session.exercises.forEach((ex, i) => {
      const k = key(ex.exerciseName);
      const upstream = session.exercises.slice(0, i);
      const previous = lastUpstream.get(k);
      if (previous) {
        const { allowance } = upstreamFatigue(ex.exerciseName, upstream, previous);
        if (allowance > 0) perExercise.set(k, allowance);
      }
      lastUpstream.set(k, upstream);
    });
    out.set(session.id, perExercise);
  }
  return out;
}

export function allowanceFor(
  map: Map<string, Map<string, number>> | undefined,
  sessionId: string,
  exerciseName: string,
): number {
  return map?.get(sessionId)?.get(key(exerciseName)) ?? 0;
}

/**
 * Strength for a session after crediting upstream fatigue: a drop the
 * allowance explains counts as holding at `previous`. Never inflates a
 * session above its previous level — explained drops are excused, not
 * rewarded.
 */
export function fatigueAdjusted(current: number, previous: number, allowance: number): number {
  if (current >= previous || allowance <= 0) return current;
  return Math.min(previous, current / (1 - allowance));
}

/**
 * Orders a session's exercises by the program's day order. Names resolve
 * through `orderByName` (lowercased name -> position, swaps included).
 * Exercises with no known position are dropped: guessing their place could
 * wrongly blame or excuse a lift.
 */
export function orderExercises(exercises: ExerciseLog[], orderByName: Map<string, number>): ExerciseLog[] {
  return exercises
    .map((e) => ({ e, pos: orderByName.get(key(e.exerciseName)) }))
    .filter((x): x is { e: ExerciseLog; pos: number } => x.pos !== undefined)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.e);
}
