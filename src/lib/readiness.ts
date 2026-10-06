/**
 * Readiness: what the post-workout check-in answers (sleep, diet, soreness,
 * pre-workout, effort, feel) do to the lifting that followed, and to each
 * other.
 *
 * Every workout gets a strength score: how its lifts compared with the same
 * lifts' average over the previous 4 weeks (widened to 8 when a lift hasn't
 * been done in 4). Check-ins are then split on each answer and the two sides
 * compared on strength, effort and feel, and the pre-lift answers are
 * combined in twos and threes to find the conditions under which workouts
 * run clearly better or worse than the rest.
 *
 * Pure module shared by the API function and the client.
 */

import type { AnalysisSessionRow, AnalysisSetRow, CheckinRow } from './analysis.js';
import { canonicalLiftKey } from './peak.js';
import { estimateOneRepMax } from './progression.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rolling baseline a workout's lifts are measured against. */
export const BASELINE_DAYS = 28;
/** Widened baseline for lifts not repeated inside BASELINE_DAYS. */
const BASELINE_FALLBACK_DAYS = 56;
/** Fewest sessions a bucket needs before its average is worth showing. */
const MIN_BUCKET = 3;
/** Buckets this size or larger are called solid rather than early. */
const SOLID_BUCKET = 6;
/** Fewest sessions a factor combination (and the rest) needs. */
const MIN_COMBO = 4;
/** Deltas below these are reported but not flagged as notable. */
const NOTABLE_STRENGTH_PCT = 2.5;
const NOTABLE_SCALE_PTS = 0.6;
/** Percentage points of strength that weigh the same as one scale point. */
const STRENGTH_PTS_PER_SCALE_PT = 3;

export type FactorKey = 'sleep' | 'diet' | 'soreness' | 'preworkout' | 'effort' | 'feel';
export type OutcomeKey = 'strength' | 'effort' | 'feel' | 'sleep' | 'soreness' | 'diet';

export const FACTOR_LABELS: Record<FactorKey, string> = {
  sleep: 'Sleep',
  diet: 'Diet',
  soreness: 'Soreness',
  preworkout: 'Pre-workout',
  effort: 'Effort',
  feel: 'Feel',
};

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  strength: 'Strength',
  effort: 'Effort',
  feel: 'Feel',
  sleep: 'Sleep',
  soreness: 'Soreness',
  diet: 'Diet',
};

/** Answers that happen before the lifting; the ones worth combining. */
const CONDITION_FACTORS: FactorKey[] = ['sleep', 'diet', 'soreness', 'preworkout'];
const OUTCOMES: OutcomeKey[] = ['strength', 'effort', 'feel', 'sleep', 'soreness', 'diet'];
const HEADLINE_OUTCOMES: OutcomeKey[] = ['strength', 'effort', 'feel'];

export interface OutcomeEffect {
  outcome: OutcomeKey;
  /** Mean in the high bucket: % vs. the 4-week baseline for strength, 1-10 otherwise. */
  high: number;
  /** Mean in the low bucket. */
  low: number;
  /** high − low: percentage points for strength, scale points otherwise. */
  delta: number;
  /** Share of high-bucket sessions whose outcome beat the median of all sessions, 0-100. */
  consistencyPct: number;
  notable: boolean;
}

export interface FactorInsight {
  factor: FactorKey;
  label: string;
  /** Scale threshold the buckets split on (null for yes/no). */
  threshold: number | null;
  /** How the buckets read, e.g. "7+" / "6 or below", "Yes" / "No". */
  highLabel: string;
  lowLabel: string;
  highCount: number;
  lowCount: number;
  /** insufficient: a bucket has under 3 sessions; early: under 6; ready otherwise. */
  status: 'ready' | 'early' | 'insufficient';
  /** Effects on every other question plus strength; empty when insufficient. */
  effects: OutcomeEffect[];
}

export interface ComboCondition {
  factor: FactorKey;
  state: 'high' | 'low';
  /** e.g. "Sleep 7+", "No pre-workout". */
  label: string;
}

export interface ComboInsight {
  conditions: ComboCondition[];
  /** Sessions matching every condition, and sessions matching none-or-some. */
  count: number;
  restCount: number;
  /** Means inside the condition (null when under 3 sessions answered it). */
  strength: number | null;
  effort: number | null;
  feel: number | null;
  /** Condition mean − rest mean. */
  strengthDelta: number | null;
  effortDelta: number | null;
  feelDelta: number | null;
  direction: 'better' | 'worse';
  /** Combined effect in scale points, signed; larger magnitude ranks first. */
  score: number;
}

export interface ReadinessReport {
  /** Check-ins on record. */
  checkins: number;
  /** Check-ins matched to a workout with a strength score. */
  matched: number;
  baselineDays: number;
  factors: FactorInsight[];
  combos: ComboInsight[];
  /** The single clearest finding, ready for the homepage. */
  headline: string | null;
}

interface SessionRow {
  date: string;
  dayName: string;
  strength: number | null;
  sleep: number | null;
  diet: number | null;
  soreness: number | null;
  preworkout: boolean | null;
  effort: number | null;
  feel: number | null;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(n: number, places = 1): number {
  return Number(n.toFixed(places));
}

function liftKeyOf(name: string): string {
  return canonicalLiftKey(name) ?? name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Per-session strength score: mean over the session's lifts of each lift's
 * best-set e1RM against that lift's average best e1RM in the previous
 * `BASELINE_DAYS` (or `BASELINE_FALLBACK_DAYS` when it wasn't done in that
 * span), as a signed percentage. Null when no lift has any baseline.
 */
export function computeSessionStrength(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
): Map<string, number> {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Best e1RM per lift per session.
  const bestByLift = new Map<string, Map<string, { t: number; e1rm: number }>>();
  for (const set of sets) {
    if (set.weight <= 0 || set.reps <= 0) continue;
    const session = sessionById.get(set.sessionId);
    if (!session) continue;
    const t = new Date(session.date).getTime();
    if (!Number.isFinite(t)) continue;
    const key = liftKeyOf(set.exerciseName);
    const e1rm = estimateOneRepMax(set.weight, set.reps);
    let perSession = bestByLift.get(key);
    if (!perSession) {
      perSession = new Map();
      bestByLift.set(key, perSession);
    }
    const existing = perSession.get(set.sessionId);
    if (!existing || e1rm > existing.e1rm) perSession.set(set.sessionId, { t, e1rm });
  }

  const relativesBySession = new Map<string, number[]>();
  for (const perSession of bestByLift.values()) {
    const ordered = [...perSession.entries()].sort((a, b) => a[1].t - b[1].t);
    for (let i = 0; i < ordered.length; i++) {
      const [sessionId, { t, e1rm }] = ordered[i];
      const baseline = (days: number) =>
        ordered
          .slice(0, i)
          .filter(([, p]) => p.t < t && p.t >= t - days * DAY_MS)
          .map(([, p]) => p.e1rm);
      let prior = baseline(BASELINE_DAYS);
      if (prior.length === 0) prior = baseline(BASELINE_FALLBACK_DAYS);
      if (prior.length === 0) continue;
      const rel = (e1rm / mean(prior) - 1) * 100;
      const list = relativesBySession.get(sessionId);
      if (list) list.push(rel);
      else relativesBySession.set(sessionId, [rel]);
    }
  }

  const out = new Map<string, number>();
  for (const [sessionId, rels] of relativesBySession) out.set(sessionId, mean(rels));
  return out;
}

/**
 * Pair each check-in with the workout it followed: same date, preferring a
 * matching day name when the date has more than one session.
 */
function matchCheckins(
  sessions: AnalysisSessionRow[],
  checkins: CheckinRow[],
  strengthBySession: Map<string, number>,
): SessionRow[] {
  const byDate = new Map<string, AnalysisSessionRow[]>();
  for (const s of sessions) {
    const d = dateOnly(s.date);
    const list = byDate.get(d);
    if (list) list.push(s);
    else byDate.set(d, [s]);
  }
  const claimed = new Set<string>();
  const rows: SessionRow[] = [];
  for (const c of checkins) {
    const candidates = (byDate.get(c.sessionDate) ?? []).filter((s) => !claimed.has(s.id));
    const session =
      candidates.find((s) => c.dayName && s.dayName === c.dayName) ?? candidates[0];
    if (session) claimed.add(session.id);
    rows.push({
      date: c.sessionDate,
      dayName: session?.dayName ?? c.dayName ?? '',
      strength: session ? (strengthBySession.get(session.id) ?? null) : null,
      sleep: c.sleep,
      diet: c.dietQuality,
      soreness: c.soreness,
      preworkout: c.tookPreworkout,
      effort: c.effort,
      feel: c.feel,
    });
  }
  return rows;
}

function outcomeValue(row: SessionRow, outcome: OutcomeKey): number | null {
  return row[outcome];
}

function factorValue(row: SessionRow, factor: FactorKey): number | boolean | null {
  return row[factor];
}

/**
 * Split point for a 1-10 answer: the threshold that balances the two buckets
 * best, breaking ties toward a conventional "good" line (7 for sleep, diet,
 * feel and effort; 5 for soreness) so the labels read naturally.
 */
function chooseThreshold(values: number[], factor: FactorKey): number | null {
  if (values.length < MIN_BUCKET * 2) return null;
  const anchor = factor === 'soreness' ? 5 : 7;
  let best: { t: number; imbalance: number } | null = null;
  for (let t = 2; t <= 10; t++) {
    const high = values.filter((v) => v >= t).length;
    const low = values.length - high;
    if (high < MIN_BUCKET || low < MIN_BUCKET) continue;
    const imbalance = Math.abs(high - low);
    if (
      !best ||
      imbalance < best.imbalance ||
      (imbalance === best.imbalance && Math.abs(t - anchor) < Math.abs(best.t - anchor))
    ) {
      best = { t, imbalance };
    }
  }
  return best?.t ?? null;
}

interface Split {
  threshold: number | null;
  highLabel: string;
  lowLabel: string;
  isHigh: (row: SessionRow) => boolean | null;
}

function splitFor(rows: SessionRow[], factor: FactorKey): Split | null {
  if (factor === 'preworkout') {
    return {
      threshold: null,
      highLabel: 'Yes',
      lowLabel: 'No',
      isHigh: (row) => row.preworkout,
    };
  }
  const values = rows.map((r) => factorValue(r, factor)).filter((v): v is number => typeof v === 'number');
  const t = chooseThreshold(values, factor);
  if (t === null) return null;
  return {
    threshold: t,
    highLabel: `${t}+`,
    lowLabel: `${t - 1} or below`,
    isHigh: (row) => {
      const v = factorValue(row, factor);
      return typeof v === 'number' ? v >= t : null;
    },
  };
}

function compareOutcome(
  outcome: OutcomeKey,
  high: SessionRow[],
  low: SessionRow[],
  all: SessionRow[],
): OutcomeEffect | null {
  const hv = high.map((r) => outcomeValue(r, outcome)).filter((v): v is number => v != null);
  const lv = low.map((r) => outcomeValue(r, outcome)).filter((v): v is number => v != null);
  if (hv.length < MIN_BUCKET || lv.length < MIN_BUCKET) return null;
  const allValues = all.map((r) => outcomeValue(r, outcome)).filter((v): v is number => v != null);
  const med = median(allValues);
  const delta = mean(hv) - mean(lv);
  const notable = Math.abs(delta) >= (outcome === 'strength' ? NOTABLE_STRENGTH_PCT : NOTABLE_SCALE_PTS);
  return {
    outcome,
    high: round(mean(hv)),
    low: round(mean(lv)),
    delta: round(delta),
    consistencyPct: Math.round((hv.filter((v) => v > med).length / hv.length) * 100),
    notable,
  };
}

function buildFactorInsight(rows: SessionRow[], factor: FactorKey): FactorInsight {
  const label = FACTOR_LABELS[factor];
  const split = splitFor(rows, factor);
  if (!split) {
    return {
      factor,
      label,
      threshold: null,
      highLabel: '',
      lowLabel: '',
      highCount: 0,
      lowCount: 0,
      status: 'insufficient',
      effects: [],
    };
  }
  const high: SessionRow[] = [];
  const low: SessionRow[] = [];
  for (const row of rows) {
    const h = split.isHigh(row);
    if (h === true) high.push(row);
    else if (h === false) low.push(row);
  }
  const smallest = Math.min(high.length, low.length);
  const status = smallest < MIN_BUCKET ? 'insufficient' : smallest < SOLID_BUCKET ? 'early' : 'ready';
  const effects: OutcomeEffect[] = [];
  if (status !== 'insufficient') {
    for (const outcome of OUTCOMES) {
      if (outcome === factor) continue;
      const effect = compareOutcome(outcome, high, low, rows);
      if (effect) effects.push(effect);
    }
  }
  return {
    factor,
    label,
    threshold: split.threshold,
    highLabel: split.highLabel,
    lowLabel: split.lowLabel,
    highCount: high.length,
    lowCount: low.length,
    status,
    effects,
  };
}

function conditionLabel(factor: FactorKey, state: 'high' | 'low', split: Split): string {
  if (factor === 'preworkout') return state === 'high' ? 'Pre-workout' : 'No pre-workout';
  if (factor === 'soreness') {
    return state === 'high' ? `Sore (${split.highLabel})` : `Fresh (soreness ${split.lowLabel})`;
  }
  return `${FACTOR_LABELS[factor]} ${state === 'high' ? split.highLabel : split.lowLabel}`;
}

function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [...subsets(tail, size - 1).map((s) => [head, ...s]), ...subsets(tail, size)];
}

function meanOrNull(rows: SessionRow[], outcome: OutcomeKey): number | null {
  const vals = rows.map((r) => outcomeValue(r, outcome)).filter((v): v is number => v != null);
  return vals.length >= MIN_BUCKET ? mean(vals) : null;
}

function buildCombos(rows: SessionRow[]): ComboInsight[] {
  const splits = new Map<FactorKey, Split>();
  for (const f of CONDITION_FACTORS) {
    const s = splitFor(rows, f);
    if (s) splits.set(f, s);
  }
  const usable = CONDITION_FACTORS.filter((f) => splits.has(f));

  const results: Array<ComboInsight & { members: string }> = [];
  for (const size of [2, 3]) {
    for (const factors of subsets(usable, size)) {
      // Every high/low assignment for this set of factors.
      for (let mask = 0; mask < 1 << size; mask++) {
        const conditions: ComboCondition[] = factors.map((factor, i) => {
          const state: 'high' | 'low' = mask & (1 << i) ? 'high' : 'low';
          return { factor, state, label: conditionLabel(factor, state, splits.get(factor)!) };
        });
        // Compare only sessions that answered every factor involved.
        const answered = rows.filter((row) => factors.every((f) => splits.get(f)!.isHigh(row) !== null));
        const inside = answered.filter((row) =>
          conditions.every((c) => splits.get(c.factor)!.isHigh(row) === (c.state === 'high')),
        );
        const rest = answered.filter((row) => !inside.includes(row));
        if (inside.length < MIN_COMBO || rest.length < MIN_COMBO) continue;

        const strength = meanOrNull(inside, 'strength');
        const effort = meanOrNull(inside, 'effort');
        const feel = meanOrNull(inside, 'feel');
        const restStrength = meanOrNull(rest, 'strength');
        const restEffort = meanOrNull(rest, 'effort');
        const restFeel = meanOrNull(rest, 'feel');
        const strengthDelta = strength != null && restStrength != null ? strength - restStrength : null;
        const effortDelta = effort != null && restEffort != null ? effort - restEffort : null;
        const feelDelta = feel != null && restFeel != null ? feel - restFeel : null;
        if (strengthDelta === null && effortDelta === null && feelDelta === null) continue;

        const score =
          (strengthDelta ?? 0) / STRENGTH_PTS_PER_SCALE_PT + (effortDelta ?? 0) + (feelDelta ?? 0);
        results.push({
          conditions,
          count: inside.length,
          restCount: rest.length,
          strength: strength != null ? round(strength) : null,
          effort: effort != null ? round(effort) : null,
          feel: feel != null ? round(feel) : null,
          strengthDelta: strengthDelta != null ? round(strengthDelta) : null,
          effortDelta: effortDelta != null ? round(effortDelta) : null,
          feelDelta: feelDelta != null ? round(feelDelta) : null,
          direction: score >= 0 ? 'better' : 'worse',
          score: round(score, 2),
          members: inside.map((r) => r.date + r.dayName).sort().join('|'),
        });
      }
    }
  }

  // A third condition that removes no sessions adds nothing: keep the shorter combo.
  const seen = new Map<string, number>();
  const deduped = results.filter((r) => {
    const prev = seen.get(r.members);
    if (prev !== undefined && prev <= r.conditions.length) return false;
    seen.set(r.members, r.conditions.length);
    return true;
  });

  // Rank by effect size, weighted toward combos with more sessions behind them.
  const ranked = deduped
    .filter((r) => Math.abs(r.score) >= 0.75)
    .sort((a, b) => Math.abs(b.score) * Math.sqrt(b.count) - Math.abs(a.score) * Math.sqrt(a.count));
  const better = ranked.filter((r) => r.direction === 'better').slice(0, 3);
  const worse = ranked.filter((r) => r.direction === 'worse').slice(0, 3);
  return [...better, ...worse].map((r) => {
    const { members: _members, ...rest } = r;
    void _members;
    return rest;
  });
}

function signed(n: number, suffix = ''): string {
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}

/** One sentence for a single-factor effect, shared by the page and the homepage. */
export function describeEffect(insight: FactorInsight, effect: OutcomeEffect): string {
  const name = insight.label.toLowerCase();
  const highDays =
    insight.factor === 'preworkout'
      ? 'pre-workout days'
      : insight.factor === 'soreness'
        ? `sore days (${insight.highLabel})`
        : `${insight.highLabel} ${name} days`;
  const lowDays =
    insight.factor === 'preworkout'
      ? 'days without it'
      : insight.factor === 'soreness'
        ? `fresh days (${insight.lowLabel})`
        : `${insight.lowLabel} days`;
  const n = `(${insight.highCount} vs ${insight.lowCount} workouts)`;
  switch (effect.outcome) {
    case 'strength': {
      const word = (v: number) => `${Math.abs(v).toFixed(1)}% ${v >= 0 ? 'above' : 'below'}`;
      return `On ${highDays} you lift ${word(effect.high)} your 4-week average, against ${word(effect.low)} on ${lowDays} ${n}.`;
    }
    case 'effort':
      return `On ${highDays} you push ${effect.delta > 0 ? 'harder' : 'less hard'}: effort ${effect.high} vs ${effect.low} on ${lowDays} ${n}.`;
    case 'feel':
      return `On ${highDays} you feel ${effect.delta > 0 ? 'better' : 'worse'}: ${effect.high} vs ${effect.low} on ${lowDays} ${n}.`;
    default:
      return `On ${highDays} your ${OUTCOME_LABELS[effect.outcome].toLowerCase()} runs ${effect.high} vs ${effect.low} on ${lowDays} ${n}.`;
  }
}

/** One sentence for a factor combination. */
export function describeCombo(combo: ComboInsight): string {
  const when = combo.conditions.map((c) => c.label.toLowerCase()).join(' + ');
  const parts: string[] = [];
  if (combo.strengthDelta != null) parts.push(`lift ${signed(combo.strengthDelta, '%')} vs your other workouts`);
  if (combo.effortDelta != null) parts.push(`effort ${signed(combo.effortDelta)}`);
  if (combo.feelDelta != null) parts.push(`feel ${signed(combo.feelDelta)}`);
  return `When ${when} line up (${combo.count} workouts) you ${parts.join(', ')}.`;
}

/** Standardized magnitude so strength and scale effects can be ranked together. */
function effectMagnitude(effect: OutcomeEffect): number {
  return Math.abs(effect.outcome === 'strength' ? effect.delta / STRENGTH_PTS_PER_SCALE_PT : effect.delta);
}

export function buildReadinessReport(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
  checkins: CheckinRow[],
): ReadinessReport {
  const strengthBySession = computeSessionStrength(sessions, sets);
  const rows = matchCheckins(sessions, checkins, strengthBySession);

  const factors = (Object.keys(FACTOR_LABELS) as FactorKey[]).map((f) => buildFactorInsight(rows, f));
  const combos = buildCombos(rows);

  // Headline: the clearest single-factor effect on strength, effort or feel.
  let headline: string | null = null;
  let best = 0;
  for (const insight of factors) {
    for (const effect of insight.effects) {
      if (!HEADLINE_OUTCOMES.includes(effect.outcome) || !effect.notable) continue;
      const magnitude = effectMagnitude(effect) * Math.sqrt(Math.min(insight.highCount, insight.lowCount));
      if (magnitude > best) {
        best = magnitude;
        headline = describeEffect(insight, effect);
      }
    }
  }

  return {
    checkins: checkins.length,
    matched: rows.filter((r) => r.strength != null).length,
    baselineDays: BASELINE_DAYS,
    factors,
    combos,
    headline,
  };
}
