/**
 * Progressive overload engine.
 *
 * Implements a "set-migration ladder": progression happens one set at a time,
 * heaviest sets first. Example with 4 sets at 90 lbs and a 10 lb increment:
 *
 *   4x90  ->  1x100 + 3x90  ->  2x100 + 2x90  ->  3x100 + 1x90  ->  4x100
 *         ->  1x110 + 3x100 -> ...
 *
 * A ladder step is promoted only when the last prescription was actually
 * earned (top sets hit their reps close to failure). When weight progression
 * stalls, the engine falls back to a rep ladder (extend reps on the first
 * set, then the first two, etc.) before trying weight again, and suggests a
 * deload after sustained regression.
 *
 * Pure module — shared by the Vercel API functions and the client. No I/O.
 */

export interface PerformedSet {
  weight: number;
  reps: number;
  /** Reps in reserve as reported by the user. Missing/unknown => assume 1. */
  rir: number;
}

export interface PlanSet {
  setNumber: number;
  weight: number;
  targetReps: number;
  targetRIR: number;
}

export type ProgressionPhase =
  | 'baseline'      // not enough history to judge — repeat last session
  | 'ladder'        // normal set-migration weight ladder
  | 'hold'          // retry the same prescription
  | 'rep-ladder'    // weight is stuck, progress reps set by set
  | 'deload';       // sustained regression, back off to rebuild

export interface ProgressionPlan {
  sets: PlanSet[];
  phase: ProgressionPhase;
  /** One or two sentences explaining why this plan was chosen. */
  rationale: string;
}

export interface ExerciseProfile {
  /** Normal weight jump when a set is promoted (total lbs). */
  increment: number;
  /** Smaller jump used when the normal one keeps failing. */
  microIncrement: number;
  /** Round recommended weights to this granularity. */
  rounding: number;
}

/**
 * Classifies an exercise into an increment profile from its name.
 * Big lower-body compounds move in large jumps, dumbbells in 5s,
 * machines in 10s, and cable isolation work in small steps down to 2.5.
 */
export function getExerciseProfile(exerciseName: string): ExerciseProfile {
  const n = exerciseName.toLowerCase();

  const isLowerCompound =
    n.includes('leg press') || n.includes('hack') || n.includes('squat') ||
    n.includes('deadlift') || n.includes('rdl');
  if (isLowerCompound) return { increment: 20, microIncrement: 10, rounding: 5 };

  const isDumbbell = n.includes('dumbbell') || n.includes(' db ') || n.startsWith('db ') || n.endsWith(' db') || n.includes('db curls') || n.includes('db press');
  if (isDumbbell) return { increment: 5, microIncrement: 5, rounding: 5 };

  // Weighted bodyweight work (dips, pull-ups): small absolute jumps matter a lot.
  const isWeightedBodyweight =
    n.includes('dip') || n.includes('pull-up') || n.includes('pull up') ||
    n.includes('chin-up') || n.includes('chin up');
  if (isWeightedBodyweight) return { increment: 5, microIncrement: 2.5, rounding: 2.5 };

  const isIsolation =
    n.includes('curl') || n.includes('fly') || n.includes('raise') ||
    n.includes('pushdown') || n.includes('push down') || n.includes('extension') ||
    n.includes('crunch') || n.includes('woodchopper') || n.includes('pulldown') && n.includes('straight');
  if (isIsolation) return { increment: 5, microIncrement: 2.5, rounding: 2.5 };

  // Machine / cable compounds (presses, rows, pulldowns): standard stack jumps.
  return { increment: 10, microIncrement: 5, rounding: 5 };
}

export interface RepRange {
  min: number;
  max: number;
}

function roundTo(value: number, granularity: number): number {
  if (granularity <= 0) return value;
  return Math.round(value / granularity) * granularity;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function workingSets(sets: PerformedSet[]): PerformedSet[] {
  return sets.filter((s) => s.weight !== 0 && s.reps > 0);
}

/** Distinct weights in a session, heaviest first. */
function weightTiers(sets: PerformedSet[]): number[] {
  return [...new Set(sets.map((s) => s.weight))].sort((a, b) => b - a);
}

interface LadderState {
  /** Heaviest working weight. */
  topWeight: number;
  /** The weight the remaining (not yet promoted) sets use. */
  baseWeight: number;
  /** How many sets are at topWeight. */
  promotedCount: number;
  /** True when every set is at the same weight (a completed rung). */
  uniform: boolean;
}

function readLadderState(sets: PerformedSet[]): LadderState {
  const tiers = weightTiers(sets);
  const topWeight = tiers[0] ?? 0;
  const baseWeight = tiers.length > 1 ? tiers[tiers.length - 1] : topWeight;
  const promotedCount = sets.filter((s) => s.weight === topWeight).length;
  return {
    topWeight,
    baseWeight,
    promotedCount,
    uniform: tiers.length <= 1,
  };
}

/** Epley-style estimate used to compare sessions for regression detection. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

function bestSetE1rm(sets: PerformedSet[]): number {
  return Math.max(0, ...sets.map((s) => estimateOneRepMax(s.weight, s.reps)));
}

/**
 * Did the lifter earn the top sets of this session? Top sets must reach the
 * pass bar (rep floor) while training near failure. rir <= 2 counts as
 * "close enough to failure" for promotion purposes.
 */
function topSetsSucceeded(sets: PerformedSet[], state: LadderState, repFloor: number): boolean {
  const tops = sets.filter((s) => s.weight === state.topWeight);
  if (tops.length === 0) return false;
  return tops.every((s) => s.reps >= repFloor);
}

/** All sets clearly too easy — reported lots of reps in reserve everywhere. */
function sessionTooEasy(sets: PerformedSet[]): boolean {
  return sets.length > 0 && sets.every((s) => s.rir >= 3);
}

function formatWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

function describeMix(sets: PlanSet[]): string {
  const groups: { weight: number; count: number }[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.weight === s.weight) last.count += 1;
    else groups.push({ weight: s.weight, count: 1 });
  }
  return groups.map((g) => `${g.count}x${formatWeight(g.weight)}`).join(' + ');
}

function buildSets(
  count: number,
  promoted: number,
  topWeight: number,
  baseWeight: number,
  topReps: number,
  baseReps: number,
): PlanSet[] {
  const sets: PlanSet[] = [];
  for (let i = 0; i < count; i++) {
    const isTop = i < promoted;
    sets.push({
      setNumber: i + 1,
      weight: isTop ? topWeight : baseWeight,
      targetReps: isTop ? topReps : baseReps,
      targetRIR: 1,
    });
  }
  return sets;
}

/**
 * How many recent sessions were stuck at the same ladder position (same top
 * weight and promoted count) without advancing. History is most-recent-first.
 */
function countStuckSessions(history: PerformedSet[][], repFloor: number): number {
  if (history.length === 0) return 0;
  const current = readLadderState(workingSets(history[0]));
  let stuck = 0;
  for (const session of history) {
    const sets = workingSets(session);
    if (sets.length === 0) break;
    const state = readLadderState(sets);
    if (state.topWeight !== current.topWeight || state.promotedCount !== current.promotedCount) break;
    // A session that actually succeeded isn't "stuck" — it just hasn't been
    // followed by the promoted prescription yet.
    if (topSetsSucceeded(sets, state, repFloor) && session === history[0]) break;
    stuck += 1;
  }
  return stuck;
}

/** Number of consecutive sessions (from most recent) with declining best e1RM. */
function regressionStreak(history: PerformedSet[][]): number {
  let streak = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const cur = bestSetE1rm(workingSets(history[i]));
    const prev = bestSetE1rm(workingSets(history[i + 1]));
    if (cur > 0 && prev > 0 && cur < prev - 0.01) streak += 1;
    else break;
  }
  return streak;
}

export interface ProgressionInput {
  exerciseName: string;
  /** Sessions, most recent first. Each session's sets in performed order. */
  history: PerformedSet[][];
  repRange: RepRange | undefined;
  targetSets: number;
}

/**
 * Main entry point: derive the next-session prescription from history alone.
 * No stored state — the ladder position is read from what was actually lifted.
 */
export function buildProgressionPlan(input: ProgressionInput): ProgressionPlan | null {
  const { exerciseName, history, targetSets } = input;
  const range: RepRange = input.repRange ?? { min: 8, max: 12 };
  const profile = getExerciseProfile(exerciseName);

  const sessions = history.map((s) => workingSets(s)).filter((s) => s.length > 0);
  if (sessions.length === 0) return null;

  const last = sessions[0].slice(0, Math.max(targetSets, 1));
  const state = readLadderState(last);
  const n = Math.max(targetSets, 1);

  // ---- Deload: three straight sessions of declining strength -----------------
  if (sessions.length >= 3 && regressionStreak(sessions) >= 3) {
    const deloadWeight = roundTo(state.topWeight * 0.9, profile.rounding);
    const base = roundTo(state.baseWeight * 0.9, profile.rounding);
    return {
      sets: buildSets(n, state.promotedCount, deloadWeight, base, range.min + 1, range.min + 1),
      phase: 'deload',
      rationale:
        'Strength has dipped three sessions in a row. Take one lighter session (~10% off) to recover, then rebuild — you usually come back past the sticking point.',
    };
  }

  const succeeded = topSetsSucceeded(last, state, range.min);
  const tooEasy = sessionTooEasy(last);
  const repCeiling = range.max + 4; // rep-ladder headroom above the range cap

  // ---- Uniform rung: every set at the same weight ---------------------------
  if (state.uniform) {
    const w = state.topWeight;
    const stuck = countStuckSessions(sessions, range.min);
    const avgReps = Math.round(last.reduce((s, x) => s + x.reps, 0) / last.length);

    if (succeeded) {
      // Rep-ladder in progress? If some sets already pushed past the range cap,
      // keep extending reps across sets before adding weight.
      const boosted = last.filter((s) => s.reps > range.max).length;
      if (boosted > 0 && boosted < n && last[0].reps > range.max) {
        const boostReps = clamp(last[0].reps, range.max + 1, repCeiling);
        const sets = buildSets(n, boosted + 1, w, w, boostReps, clamp(avgReps, range.min, range.max));
        return {
          sets,
          phase: 'rep-ladder',
          rationale: `Weight is parked at ${formatWeight(w)}, so we're stretching reps instead: first ${boosted + 1} sets aim for ${boostReps} reps, rest stay in range. Once every set is there, we go back to adding weight.`,
        };
      }
      if (boosted >= n) {
        // Full rep ladder complete — cash it in for a weight jump.
        const nextTop = roundTo(w + profile.increment, profile.rounding);
        const sets = buildSets(n, 1, nextTop, w, range.min, clamp(avgReps, range.min, range.max));
        return {
          sets,
          phase: 'ladder',
          rationale: `You pushed all ${n} sets past the rep cap at ${formatWeight(w)} — that plateau is broken. Cash it in: ${describeMix(sets)}.`,
        };
      }

      // Normal successful rung: start the next ladder rung.
      const jump = tooEasy ? profile.increment * 2 : profile.increment;
      const nextTop = roundTo(w + jump, profile.rounding);
      const promoted = tooEasy ? Math.min(2, n) : 1;
      const sets = buildSets(n, promoted, nextTop, w, range.min, clamp(avgReps, range.min, range.max));
      return {
        sets,
        phase: 'ladder',
        rationale: tooEasy
          ? `All sets at ${formatWeight(w)} had 3+ reps in reserve — that's too easy. Skipping ahead: ${describeMix(sets)}.`
          : `You completed all ${n} sets at ${formatWeight(w)}. Time to start the next rung: ${describeMix(sets)}, heaviest set first.`,
      };
    }

    // Didn't earn all sets at this weight.
    if (stuck >= 3) {
      // Plateau — switch to the rep ladder (or micro-load if reps are maxed out).
      if (last[0].reps >= repCeiling) {
        const nextTop = roundTo(w + profile.microIncrement, profile.rounding);
        const sets = buildSets(n, 1, nextTop, w, range.min, clamp(avgReps, range.min, range.max));
        return {
          sets,
          phase: 'ladder',
          rationale: `Reps are maxed out at ${formatWeight(w)}. Trying a smaller jump than usual: just +${profile.microIncrement} on the first set.`,
        };
      }
      const boostReps = clamp(last[0].reps + 2, range.min + 1, repCeiling);
      const sets = buildSets(n, 1, w, w, boostReps, clamp(avgReps, range.min, range.max));
      return {
        sets,
        phase: 'rep-ladder',
        rationale: `Three sessions stuck at ${formatWeight(w)}. New angle: keep the weight, push the first set to ${boostReps} reps, then extend set by set.`,
      };
    }

    const sets = buildSets(n, 0, w, w, clamp(avgReps + 1, range.min, range.max), clamp(avgReps, range.min, range.max));
    return {
      sets,
      phase: 'hold',
      rationale: `Not every set reached ${range.min} reps at ${formatWeight(w)} yet. Own this weight first — same prescription, aim for at least ${range.min} on every set.`,
    };
  }

  // ---- Mid-ladder: k sets promoted to topWeight, rest at baseWeight ---------
  const { topWeight, baseWeight, promotedCount } = state;
  const baseReps = clamp(
    Math.round(
      last.filter((s) => s.weight === baseWeight).reduce((s, x) => s + x.reps, 0) /
        Math.max(1, last.filter((s) => s.weight === baseWeight).length),
    ),
    range.min,
    range.max,
  );

  if (succeeded) {
    if (promotedCount + 1 >= n) {
      // Final promotion: all sets to the top weight (completes the rung).
      const sets = buildSets(n, n, topWeight, topWeight, range.min, range.min);
      return {
        sets,
        phase: 'ladder',
        rationale: `The ${formatWeight(topWeight)} sets are solid. Last step of this rung: all ${n} sets at ${formatWeight(topWeight)}.`,
      };
    }
    const promoted = tooEasy ? Math.min(promotedCount + 2, n) : promotedCount + 1;
    const sets = buildSets(n, promoted, topWeight, baseWeight, range.min, baseReps);
    return {
      sets,
      phase: 'ladder',
      rationale: tooEasy
        ? `Everything had 3+ reps in reserve — promoting two sets at once: ${describeMix(sets)}.`
        : `${promotedCount} ${promotedCount === 1 ? 'set' : 'sets'} at ${formatWeight(topWeight)} went well. Promote one more: ${describeMix(sets)}.`,
    };
  }

  // Top sets failed mid-ladder.
  const stuck = countStuckSessions(sessions, range.min);
  if (stuck >= 2) {
    // Two failed tries at this step — drop back a step to rebuild momentum.
    const demoted = Math.max(0, promotedCount - 1);
    const sets = demoted === 0
      ? buildSets(n, 0, baseWeight, baseWeight, range.max, clamp(baseReps + 1, range.min, range.max))
      : buildSets(n, demoted, topWeight, baseWeight, range.min, baseReps);
    return {
      sets,
      phase: 'hold',
      rationale: demoted === 0
        ? `${formatWeight(topWeight)} isn't there yet. Drop back to ${formatWeight(baseWeight)} for all sets and push reps toward ${range.max} to build the base.`
        : `Two tries at ${promotedCount}x${formatWeight(topWeight)} without locking it in. One step back (${describeMix(sets)}) to rebuild, then climb again.`,
    };
  }

  const sets = buildSets(n, promotedCount, topWeight, baseWeight, range.min, baseReps);
  return {
    sets,
    phase: 'hold',
    rationale: `The ${formatWeight(topWeight)} ${promotedCount === 1 ? 'set' : 'sets'} didn't hit ${range.min} reps yet. Run it back — same prescription until it's earned.`,
  };
}
