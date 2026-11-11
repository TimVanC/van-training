/**
 * Progressive overload engine.
 *
 * Implements a "set-migration ladder": progression happens one set at a time,
 * heaviest sets first. Example with 4 sets at 90 lbs and a 10 lb increment:
 *
 *   4x90  ->  1x100 + 3x90  ->  2x100 + 2x90  ->  3x100 + 1x90  ->  4x100
 *         ->  1x110 + 3x100 -> ...
 *
 * The ladder decides what the next step *would* be; a realism check then
 * decides whether that step is actually reachable. Every set is judged on
 * its own evidence — effective reps (reps + RIR) at its position in the
 * session — and sets after the first are fatigued by the ones before them
 * (the lifter's own set-to-set rep drop, read from history). A promotion that
 * projects below the rep floor becomes a "build" step instead: same weights,
 * one more rep on the set that gates the promotion.
 *
 * Fatigue from earlier exercises in the session (see fatigue.ts) feeds in two
 * ways: drops it explains don't count as regression or stalling, and when
 * today's upstream lifts went up, targets are trimmed to what's realistic.
 *
 * Time away works the same way: after a layoff from the exercise's main
 * muscle, expected strength is scaled down by `layoffRetention` before the
 * realism check, and long layoffs drop the weight rather than the reps.
 *
 * When weight progression stalls, the engine falls back to a rep ladder
 * (extend reps on the first set, then the first two, etc.) before trying
 * weight again, and suggests a deload after sustained regression.
 *
 * Pure module — shared by the Vercel API functions and the client. No I/O.
 */

import { fatigueAdjusted, MEANINGFUL_ALLOWANCE, type FatigueReport } from './fatigue.js';

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
  | 'build'         // next ladder step isn't realistic yet — add reps first
  | 'hold'          // retry the same prescription
  | 'rep-ladder'    // weight is stuck, progress reps set by set
  | 'deload';       // sustained regression, back off to rebuild

/** What scaled expected strength for this plan, shown as badges. */
export type PlanAdjustment = 'fatigue' | 'layoff';

export interface ProgressionPlan {
  sets: PlanSet[];
  phase: ProgressionPhase;
  /** One or two sentences explaining why this plan was chosen. */
  rationale: string;
  adjustments?: PlanAdjustment[];
}

/** Strength holds for about three weeks without training a muscle. */
const LAYOFF_GRACE_DAYS = 21;
/** Below this much expected loss, a layoff doesn't change the plan. */
const MEANINGFUL_LAYOFF_LOSS = 0.02;

/**
 * Expected strength loss by days without training a muscle, as
 * [days, loss] points joined by straight lines. Nothing is lost for three
 * weeks; 6-9 weeks costs 8-10% and 9-14 weeks 11-16%, levelling off there.
 * The 6-14 week values are the owner's call: their own comeback history
 * agreed up to 9 weeks but showed less loss after that, which reads as
 * sampling skew (few, easier comebacks) rather than recovery.
 */
const LAYOFF_LOSS_CURVE: ReadonlyArray<readonly [number, number]> = [
  [LAYOFF_GRACE_DAYS, 0],
  [42, 0.08],
  [63, 0.1],
  [98, 0.16],
];

/** Share of strength kept after `days` without training a muscle (0.84..1). */
export function layoffRetention(days: number): number {
  if (!(days > LAYOFF_GRACE_DAYS)) return 1;
  const last = LAYOFF_LOSS_CURVE[LAYOFF_LOSS_CURVE.length - 1];
  if (days >= last[0]) return 1 - last[1];
  const i = LAYOFF_LOSS_CURVE.findIndex(([d]) => d >= days);
  const [d0, l0] = LAYOFF_LOSS_CURVE[i - 1];
  const [d1, l1] = LAYOFF_LOSS_CURVE[i];
  return 1 - (l0 + ((l1 - l0) * (days - d0)) / (d1 - d0));
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

/** RIR beyond this says more about the set being a warm-up than about capacity. */
const MAX_COUNTED_RIR = 4;
/** Effective reps lost set to set at the same weight when history can't tell us. */
const DEFAULT_SET_DROP = 2;
/** Target RIR when nothing has been logged to match. */
const DEFAULT_TARGET_RIR = 1;

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

/** Reps plus reps in reserve: what the set was really worth. */
function effectiveReps(s: PerformedSet): number {
  return s.reps + clamp(s.rir, 0, MAX_COUNTED_RIR);
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

/** Inverse Epley: reps to failure at `weight` for a given e1RM. */
function repsAtWeight(e1rm: number, weight: number): number {
  if (weight <= 0) return 0;
  return 30 * (e1rm / weight - 1);
}

function setE1rm(s: PerformedSet): number {
  return estimateOneRepMax(s.weight, effectiveReps(s));
}

function bestSetE1rm(sets: PerformedSet[]): number {
  return Math.max(0, ...sets.map(setE1rm));
}

/**
 * Did the lifter earn the top sets of this session? Top sets must reach the
 * pass bar (rep floor).
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

/**
 * Typical effective reps lost from one set to the next at the same weight
 * (median over recent sessions, so one blown set doesn't skew it). This is
 * what makes a promoted second set harder than the same weight on a fresh
 * first set.
 */
function interSetDrop(sessions: PerformedSet[][]): number {
  const drops: number[] = [];
  for (const sets of sessions.slice(0, 6)) {
    for (let i = 1; i < sets.length; i++) {
      if (sets[i].weight === sets[i - 1].weight) drops.push(effectiveReps(sets[i - 1]) - effectiveReps(sets[i]));
    }
  }
  if (drops.length === 0) return DEFAULT_SET_DROP;
  drops.sort((a, b) => a - b);
  const mid = Math.floor(drops.length / 2);
  const median = drops.length % 2 ? drops[mid] : (drops[mid - 1] + drops[mid]) / 2;
  return clamp(median, 0, 4);
}

/** Train at the effort actually being trained at, not a fixed RIR. */
function targetRirFor(last: PerformedSet[]): number {
  if (last.length === 0) return DEFAULT_TARGET_RIR;
  const mean = last.reduce((s, x) => s + x.rir, 0) / last.length;
  return clamp(Math.round(mean), 0, 2);
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

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
      targetRIR: DEFAULT_TARGET_RIR,
    });
  }
  return sets;
}

/**
 * How many recent sessions were stuck at the same ladder position (same top
 * weight and promoted count) without advancing. History is most-recent-first.
 * Sessions whose miss is explained by upstream fatigue aren't counted.
 */
function countStuckSessions(history: PerformedSet[][], fatigue: number[], repFloor: number): number {
  if (history.length === 0) return 0;
  const current = readLadderState(history[0]);
  let stuck = 0;
  for (let i = 0; i < history.length; i++) {
    const sets = history[i];
    const state = readLadderState(sets);
    if (state.topWeight !== current.topWeight || state.promotedCount !== current.promotedCount) break;
    // A session that actually succeeded isn't "stuck" — it just hasn't been
    // followed by the promoted prescription yet.
    if (i === 0 && topSetsSucceeded(sets, state, repFloor)) break;
    if ((fatigue[i] ?? 0) >= MEANINGFUL_ALLOWANCE) continue;
    stuck += 1;
  }
  return stuck;
}

/**
 * Consecutive sessions (from most recent) with declining best e1RM, after
 * excusing drops that upstream fatigue explains.
 */
function regressionStreak(history: PerformedSet[][], fatigue: number[]): number {
  let streak = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const prev = bestSetE1rm(history[i + 1]);
    const cur = fatigueAdjusted(bestSetE1rm(history[i]), prev, fatigue[i] ?? 0);
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
  /**
   * Upstream-fatigue allowance per history session (aligned with `history`):
   * how much of a drop that session's earlier exercises explain. Missing = 0.
   */
  historyFatigue?: number[];
  /** Extra fatigue carried into today from exercises already done this session. */
  todayFatigue?: FatigueReport;
  /** Days since the exercise's main muscle was last trained, and that muscle's name. */
  layoff?: { days: number; muscle: string };
}

interface PlanContext {
  n: number;
  range: RepRange;
  profile: ExerciseProfile;
  last: PerformedSet[];
  state: LadderState;
  sessions: PerformedSet[][];
  fatigue: number[];
  targetRir: number;
  setDrop: number;
  /** Strength available today relative to last time (1 = fresh as usual). */
  todayFactor: number;
  todayDrivers: string[];
  /** Part of todayFactor that comes from time away (1 = no layoff). */
  layoffFactor: number;
  layoff?: { days: number; muscle: string };
}

interface Prediction {
  /** Predicted effective reps (reps + RIR) for the set. */
  reps: number;
  /** True when fatigue from the set before it, not the set's own strength, is the limit. */
  chained: boolean;
}

/** The performed set at the same position last time (or the last one logged). */
function refSet(ctx: PlanContext, i: number): PerformedSet {
  return ctx.last[Math.min(i, ctx.last.length - 1)];
}

/**
 * Predicted effective reps for each set of a candidate plan. Sets at the
 * same weight as last time are predicted from what was done there. A set at
 * a new weight is converted from its own last performance, and when the set
 * before it sits at that same weight it can't beat that set minus the usual
 * set-to-set drop — a second set at 60 follows a first set at 60, not a
 * fresh start.
 */
function predictEffectiveReps(plan: PlanSet[], ctx: PlanContext): Prediction[] {
  const out: Prediction[] = [];
  plan.forEach((set, i) => {
    const ref = refSet(ctx, i);
    const own = repsAtWeight(setE1rm(ref) * ctx.todayFactor, set.weight);
    const chain = ref.weight !== set.weight && i > 0 && plan[i - 1].weight === set.weight
      ? out[i - 1].reps - ctx.setDrop
      : Infinity;
    out.push({ reps: Math.min(own, chain), chained: chain < own });
  });
  return out;
}

/** Last time's reps at a set, re-expressed at today's target RIR. */
function matchedReps(ctx: PlanContext, i: number): number {
  return Math.max(1, Math.round(effectiveReps(refSet(ctx, i)) - ctx.targetRir));
}

/**
 * Reps needed at `fromWeight` (at the target RIR) before `targetReps` at
 * `toWeight` is a realistic fresh set.
 */
function repsNeededFor(fromWeight: number, toWeight: number, targetReps: number, rir: number): number {
  const e1rm = estimateOneRepMax(toWeight, targetReps + rir);
  return Math.ceil(repsAtWeight(e1rm, fromWeight) - rir);
}

/**
 * Same weights as last time, one more rep on the set that gates the
 * promotion the ladder wanted (`blocked` is the first unrealistic set).
 */
function buildStep(ctx: PlanContext, desired: PlanSet[], blocked: number, chained: boolean): ProgressionPlan {
  const sets: PlanSet[] = desired.map((_, i) => ({
    setNumber: i + 1,
    weight: refSet(ctx, i).weight,
    targetReps: matchedReps(ctx, i),
    targetRIR: ctx.targetRir,
  }));

  const target = desired[blocked];
  const gate = chained ? blocked - 1 : blocked;
  sets[gate].targetReps += 1;

  const gateSet = sets[gate];
  const rirText = `${ctx.targetRir} RIR`;
  if (chained) {
    const need = Math.min(ctx.range.max, Math.ceil(target.targetReps + ctx.setDrop));
    const drop = Math.max(1, Math.round(ctx.setDrop));
    return {
      sets,
      phase: 'build',
      rationale:
        `Moving set ${blocked + 1} up to ${formatWeight(target.weight)} isn't realistic yet: after a ${rirText} set at that weight you lose about ${drop} ${drop === 1 ? 'rep' : 'reps'}, so it would land short of ${target.targetReps}. ` +
        `Build the cushion first — aim for ${gateSet.targetReps} on set ${gate + 1} at ${formatWeight(gateSet.weight)}. Set ${blocked + 1} moves up once set ${gate + 1} reaches about ${need}.`,
    };
  }
  // The ladder moves anyway once the set tops the rep range, so that's the most it ever needs.
  const need = Math.min(ctx.range.max, repsNeededFor(gateSet.weight, target.weight, target.targetReps, ctx.targetRir));
  return {
    sets,
    phase: 'build',
    rationale:
      `Set ${gate + 1} at ${formatWeight(target.weight)} now projects to fewer than ${target.targetReps} reps. ` +
      `Add reps at ${formatWeight(gateSet.weight)} first — aim for ${gateSet.targetReps}. Once set ${gate + 1} reaches about ${need} there, it moves up to ${formatWeight(target.weight)}.`,
  };
}

/**
 * Today's upstream lifts went up, or the muscle has been off for a while, and
 * the next step isn't realistic on top of that: last time's weights, with
 * each target trimmed to what's realistic. After a layoff, a set that would
 * fall under the rep floor drops weight instead.
 */
function fatigueHold(ctx: PlanContext): ProgressionPlan {
  const base: PlanSet[] = Array.from({ length: ctx.n }, (_, i) => ({
    setNumber: i + 1,
    weight: refSet(ctx, i).weight,
    targetReps: matchedReps(ctx, i),
    targetRIR: ctx.targetRir,
  }));
  const pred = predictEffectiveReps(base, ctx);
  const sets = base.map((s, i) => {
    if (s.weight <= 0) return s;
    const trimmed = { ...s, targetReps: Math.max(1, Math.min(s.targetReps, Math.floor(pred[i].reps - ctx.targetRir + 0.5))) };
    return ctx.layoffFactor < 1 && trimmed.targetReps < ctx.range.min ? lighterSet(ctx, i, trimmed) : trimmed;
  });
  const trimmed = sets.some((s, i) => s.weight < base[i].weight || s.targetReps < base[i].targetReps);
  return { sets, phase: 'hold', rationale: adjustedRationale(ctx, trimmed) };
}

/**
 * Steps a set's weight down until it projects to at least the rep floor
 * (at most three steps), for comebacks where reps alone would sink too low.
 */
function lighterSet(ctx: PlanContext, i: number, set: PlanSet): PlanSet {
  const e1rm = setE1rm(refSet(ctx, i)) * ctx.todayFactor;
  const step = Math.max(ctx.profile.increment, ctx.profile.rounding);
  for (let k = 1; k <= 3; k++) {
    const weight = roundTo(set.weight - step * k, ctx.profile.rounding);
    if (weight <= 0) break;
    const reps = Math.floor(repsAtWeight(e1rm, weight) - ctx.targetRir + 0.5);
    if (reps >= ctx.range.min) return { ...set, weight, targetReps: Math.min(reps, ctx.range.max) };
  }
  return set;
}

function layoffSentence(ctx: PlanContext): string {
  if (!ctx.layoff) return '';
  const weeks = Math.round(ctx.layoff.days / 7);
  const pct = Math.round((1 - ctx.layoffFactor) * 100);
  return `It's been about ${weeks} weeks since you last trained ${ctx.layoff.muscle.toLowerCase()}, so expect roughly ${pct}% less strength than last time.`;
}

function adjustedRationale(ctx: PlanContext, trimmed: boolean): string {
  const parts: string[] = [];
  if (ctx.layoff) parts.push(layoffSentence(ctx));
  if (ctx.todayDrivers.length > 0) {
    const verb = ctx.todayDrivers.length === 1 ? 'hits' : 'hit';
    parts.push(`${listNames(ctx.todayDrivers)} went up earlier today and ${verb} the same muscles.`);
  }
  parts.push(
    trimmed
      ? "Targets are trimmed to what's realistic. Hitting them — or matching last time — is a win."
      : 'Matching last time here is a win.',
  );
  return parts.join(' ');
}

/** The step the ladder wants next, before any realism check. */
function ladderStep(ctx: PlanContext, allowSkip: boolean): ProgressionPlan {
  const { n, range, profile, last, state, sessions, fatigue } = ctx;
  const succeeded = topSetsSucceeded(last, state, range.min);
  const tooEasy = allowSkip && sessionTooEasy(last);
  const repCeiling = range.max + 4; // rep-ladder headroom above the range cap

  // ---- Uniform rung: every set at the same weight ---------------------------
  if (state.uniform) {
    const w = state.topWeight;
    const stuck = countStuckSessions(sessions, fatigue, range.min);
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
          : `You completed all ${n} sets at ${formatWeight(w)}. Time to move up: ${describeMix(sets)}, heaviest set first.`,
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
        rationale: `Three sessions stuck at ${formatWeight(w)}. Trying something different: keep the weight, push the first set to ${boostReps} reps, then extend set by set.`,
      };
    }

    const sets = buildSets(n, 0, w, w, clamp(avgReps + 1, range.min, range.max), clamp(avgReps, range.min, range.max));
    return {
      sets,
      phase: 'hold',
      rationale: `Not every set reached ${range.min} reps at ${formatWeight(w)} yet. Stay at this weight and aim for at least ${range.min} reps on every set.`,
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
        rationale: `The ${formatWeight(topWeight)} sets are solid. Last step before the next jump: all ${n} sets at ${formatWeight(topWeight)}.`,
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
  const stuck = countStuckSessions(sessions, fatigue, range.min);
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
    rationale: `The ${formatWeight(topWeight)} ${promotedCount === 1 ? 'set' : 'sets'} didn't hit ${range.min} reps yet. Repeat the same weights and reps until they're there.`,
  };
}

/**
 * Checks the ladder's step against what the lifter has shown they can do,
 * and adapts it: unrealistic promotions become build steps, targets follow
 * the RIR actually trained at, and today's upstream fatigue trims targets.
 */
function realize(ctx: PlanContext, allowSkip: boolean): ProgressionPlan {
  const step = ladderStep(ctx, allowSkip);
  const plan: ProgressionPlan = {
    ...step,
    sets: step.sets.map((s) => ({ ...s, targetRIR: ctx.targetRir })),
  };

  const promotedAt = plan.sets
    .map((s, i) => (s.weight > 0 && refSet(ctx, i).weight > 0 && s.weight > refSet(ctx, i).weight ? i : -1))
    .filter((i) => i >= 0);

  if (promotedAt.length > 0) {
    const pred = predictEffectiveReps(plan.sets, ctx);
    const blocked = promotedAt.find((i) => pred[i].reps - ctx.targetRir + 0.5 < plan.sets[i].targetReps);
    if (blocked === undefined) {
      // Promoted sets aim for what the numbers support (at least the floor);
      // the rest aim to match what they did last time.
      const sets = plan.sets.map((s, i) => {
        if (promotedAt.includes(i)) {
          return { ...s, targetReps: clamp(Math.floor(pred[i].reps - ctx.targetRir + 0.5), ctx.range.min, ctx.range.max) };
        }
        return s.weight === refSet(ctx, i).weight ? { ...s, targetReps: matchedReps(ctx, i) } : s;
      });
      const reasons = [
        ...(ctx.layoff ? ['the time away'] : []),
        ...(ctx.todayDrivers.length > 0 ? [`${listNames(ctx.todayDrivers)} up earlier today`] : []),
      ];
      const note = reasons.length > 0 ? ` Even with ${reasons.join(' and ')}, the numbers support it.` : '';
      return { ...plan, sets, rationale: plan.rationale + note };
    }
    // A double jump that isn't realistic still might be as a single step.
    if (allowSkip && sessionTooEasy(ctx.last)) return realize(ctx, false);
    if (ctx.todayFactor < 1) return fatigueHold(ctx);
    const { chained } = pred[blocked];
    // The gating set is already at the top of the range: the ladder has to move anyway.
    if (refSet(ctx, chained ? blocked - 1 : blocked).reps >= ctx.range.max) return plan;
    return buildStep(ctx, plan.sets, blocked, chained);
  }

  if (ctx.todayFactor < 1) return fatigueHold(ctx);
  if (plan.phase === 'hold' && (ctx.fatigue[0] ?? 0) >= MEANINGFUL_ALLOWANCE) {
    return {
      ...plan,
      rationale: `Last time earlier lifts hit these muscles harder than usual, so that miss doesn't count against you. ${plan.rationale}`,
    };
  }
  return plan;
}

/**
 * Main entry point: derive the next-session prescription from history alone.
 * No stored state — the ladder position is read from what was actually lifted.
 */
export function buildProgressionPlan(input: ProgressionInput): ProgressionPlan | null {
  const { exerciseName, history, targetSets } = input;
  const range: RepRange = input.repRange ?? { min: 8, max: 12 };
  const profile = getExerciseProfile(exerciseName);

  const kept = history
    .map((s, i) => ({ sets: workingSets(s), fatigue: input.historyFatigue?.[i] ?? 0 }))
    .filter((s) => s.sets.length > 0);
  if (kept.length === 0) return null;
  const sessions = kept.map((s) => s.sets);
  const fatigue = kept.map((s) => s.fatigue);

  const n = Math.max(targetSets, 1);
  const last = sessions[0].slice(0, n);
  const state = readLadderState(last);
  const today = input.todayFatigue;
  const todayMeaningful = today !== undefined && today.allowance >= MEANINGFUL_ALLOWANCE;
  const retention = input.layoff ? layoffRetention(input.layoff.days) : 1;
  const layoffMeaningful = 1 - retention >= MEANINGFUL_LAYOFF_LOSS;
  const layoffFactor = layoffMeaningful ? retention : 1;

  const ctx: PlanContext = {
    n,
    range,
    profile,
    last,
    state,
    sessions,
    fatigue,
    targetRir: targetRirFor(last),
    setDrop: interSetDrop(sessions),
    todayFactor: (todayMeaningful ? 1 - today.allowance : 1) * layoffFactor,
    todayDrivers: todayMeaningful ? today.drivers.slice(0, 2).map((d) => d.exerciseName) : [],
    layoffFactor,
    layoff: layoffMeaningful ? input.layoff : undefined,
  };

  // ---- Deload: three straight sessions of declining strength -----------------
  if (sessions.length >= 3 && regressionStreak(sessions, fatigue) >= 3) {
    const deloadWeight = roundTo(state.topWeight * 0.9, profile.rounding);
    const base = roundTo(state.baseWeight * 0.9, profile.rounding);
    const sets = buildSets(n, state.promotedCount, deloadWeight, base, range.min + 1, range.min + 1)
      .map((s) => ({ ...s, targetRIR: 2 }));
    return {
      sets,
      phase: 'deload',
      rationale:
        'Strength has dipped three sessions in a row, even after allowing for fatigue from earlier lifts. Take one lighter session (~10% off) to recover, then rebuild — you usually come back past the sticking point.',
    };
  }

  const plan = realize(ctx, true);
  const adjustments: PlanAdjustment[] = [
    ...(todayMeaningful ? (['fatigue'] as const) : []),
    ...(layoffMeaningful ? (['layoff'] as const) : []),
  ];
  return adjustments.length > 0 ? { ...plan, adjustments } : plan;
}
