/**
 * Peak Strength: where each lift (and muscle group) sits today relative to
 * the strongest it has ever been, across the pre-van.training spreadsheets
 * and the app's own log.
 *
 * Exercise names drift between eras ("DB Bench Press" → "Flat Dumbbell
 * Press"), so sets are first mapped onto a canonical lift lineage, then each
 * lineage is scored per session by its best set. Pure module shared by the
 * API function and the client.
 */

import { MUSCLE_GROUPS, type MuscleGroup } from './muscles.js';
import { MUSCLE_HEADS, headEmphasis } from './muscleHeads.js';

export interface PeakSetRow {
  /** Session id (app) or spreadsheet session key (history). */
  sessionKey: string;
  /** ISO date or timestamp. */
  date: string;
  dateEstimated: boolean;
  splitName: string;
  splitAbbr: string;
  exerciseName: string;
  weight: number;
  reps: number;
  /** Drop sets and flagged outliers stay out of the scoring. */
  excluded?: boolean;
  source: 'app' | 'history';
}

export interface PeakPoint {
  date: string;
  dateEstimated: boolean;
  splitAbbr: string;
  splitName: string;
  weight: number;
  reps: number;
  score: number;
}

export interface PeakLiftSummary {
  key: string;
  label: string;
  group: MuscleGroup;
  bodyweight: boolean;
  /** The most recent session for this lift. */
  current: PeakPoint;
  peak: PeakPoint;
  /** current.score / peak.score, 0–100. */
  pctOfPeak: number;
  /** True when the lift hasn't been trained inside the recent window. */
  stale: boolean;
  atPeak: boolean;
  sessions: number;
  firstTrained: string;
  lastTrained: string;
  /** Best session in each split, oldest split first. */
  bySplit: PeakPoint[];
}

export interface PeakHeadSummary {
  head: string;
  /** Emphasis-weighted percent of peak across active lifts, null when none. */
  pctOfPeak: number | null;
  liftKeys: string[];
}

export interface PeakGroupSummary {
  group: MuscleGroup;
  pctOfPeak: number | null;
  activeLifts: number;
  totalLifts: number;
  atPeakCount: number;
  /** Split abbreviation holding the most lift peaks in this group. */
  peakEra: string | null;
  heads: PeakHeadSummary[];
  lifts: PeakLiftSummary[];
}

export interface PeakSplitSummary {
  abbr: string;
  name: string;
  firstDate: string;
  lastDate: string;
  sessions: number;
  source: 'app' | 'history';
}

export interface PeakReport {
  overallPctOfPeak: number | null;
  activeLifts: number;
  liftsAtPeak: number;
  totalLifts: number;
  firstDate: string | null;
  recentWindowDays: number;
  splits: PeakSplitSummary[];
  groups: PeakGroupSummary[];
}

/** Assumed bodyweight so pull-ups/dips score on total load, not added load. */
export const BODYWEIGHT_LBS = 200;
export const RECENT_WINDOW_DAYS = 42;

const DAY_MS = 24 * 60 * 60 * 1000;

interface LiftDef {
  label: string;
  group: MuscleGroup;
  bodyweight?: boolean;
  /** Name fed to headEmphasis when the label lacks the right keywords. */
  emphasisHint?: string;
}

const LIFTS: Record<string, LiftDef> = {
  // Chest
  'incline-db-press': { label: 'Incline DB Press', group: 'Chest' },
  'flat-db-press': { label: 'Flat DB Press', group: 'Chest' },
  'decline-machine-press': { label: 'Decline Machine Press', group: 'Chest' },
  'flat-machine-press': { label: 'Flat Machine Press', group: 'Chest' },
  'pec-deck': { label: 'Pec Deck', group: 'Chest', emphasisHint: 'pec fly' },
  'single-arm-pec-deck': { label: 'Single-Arm Pec Deck', group: 'Chest', emphasisHint: 'pec fly' },
  'high-to-low-fly': { label: 'High to Low Cable Fly', group: 'Chest' },
  'low-to-high-fly': { label: 'Low to High Cable Fly', group: 'Chest' },
  'chest-dips': { label: 'Chest Dips', group: 'Chest', bodyweight: true, emphasisHint: 'dip' },
  // Triceps
  'tricep-pushdown': { label: 'Triceps Pushdown', group: 'Triceps' },
  'pronated-pushdown': { label: 'Pronated Pushdown', group: 'Triceps' },
  'overhead-tricep-ext': { label: 'Overhead Cable Extension', group: 'Triceps' },
  'single-arm-tricep-ext': { label: 'Single-Arm Cable Extension', group: 'Triceps', emphasisHint: 'pushdown' },
  'dual-cable-ext': { label: 'Dual Cable Extension', group: 'Triceps', emphasisHint: 'pushdown' },
  'katana-ext': { label: 'Katana Extension', group: 'Triceps', emphasisHint: 'overhead' },
  skullcrushers: { label: 'Skullcrushers', group: 'Triceps', emphasisHint: 'skull' },
  // Back
  'lat-pulldown': { label: 'Lat Pulldown', group: 'Back' },
  'single-arm-lat-pulldown': { label: 'Single-Arm Lat Pulldown', group: 'Back', emphasisHint: 'pulldown' },
  'straight-arm-pulldown': { label: 'Straight-Arm Pulldown', group: 'Back', emphasisHint: 'pulldown' },
  'seated-row': { label: 'Seated Cable Row', group: 'Back' },
  'wide-grip-row': { label: 'Wide-Grip Cable Row', group: 'Back' },
  'barbell-row': { label: 'Barbell Row', group: 'Back' },
  'db-row': { label: 'DB Row', group: 'Back' },
  'landmine-row': { label: 'Landmine Row', group: 'Back' },
  'pull-ups': { label: 'Pull-Ups', group: 'Back', bodyweight: true, emphasisHint: 'pull-up' },
  'back-extension': { label: 'Back Extension', group: 'Back', emphasisHint: 'extension' },
  shrugs: { label: 'DB Shrugs', group: 'Back', emphasisHint: 'shrug' },
  // Biceps
  'hammer-curl': { label: 'Hammer Curl', group: 'Biceps' },
  'preacher-curl': { label: 'Preacher Curl', group: 'Biceps' },
  'incline-db-curl': { label: 'Incline DB Curl', group: 'Biceps' },
  'incline-cable-curl': { label: 'Incline Cable Curl', group: 'Biceps' },
  'cable-curl': { label: 'Cable Curl', group: 'Biceps', emphasisHint: 'curl' },
  'reverse-curl': { label: 'Reverse Curl', group: 'Biceps' },
  'reverse-cable-curl': { label: 'Reverse Cable Curl', group: 'Biceps' },
  'supinated-pulldown': { label: 'Supinated Biceps Pulldown', group: 'Biceps', emphasisHint: 'curl' },
  // Shoulders
  'db-shoulder-press': { label: 'DB Shoulder Press', group: 'Shoulders' },
  'cable-lateral-raise': { label: 'Cable Lateral Raise', group: 'Shoulders' },
  'dual-lateral-raise': { label: 'Dual Cable Lateral Raise', group: 'Shoulders', emphasisHint: 'lateral' },
  'cable-y-raise': { label: 'Cable Y-Raise', group: 'Shoulders', emphasisHint: 'lateral' },
  'rear-delt-cable-fly': { label: 'Rear Delt Cable Fly', group: 'Shoulders', emphasisHint: 'rear delt' },
  'face-pull': { label: 'Face Pull', group: 'Shoulders' },
  'reverse-pec-deck': { label: 'Reverse Pec Deck', group: 'Shoulders', emphasisHint: 'reverse' },
  // Quads / hamstrings / calves
  'leg-press': { label: 'Leg Press', group: 'Quads', emphasisHint: 'press' },
  'hack-squat': { label: 'Hack Squat', group: 'Quads', emphasisHint: 'hack' },
  'leg-extension': { label: 'Leg Extension', group: 'Quads', emphasisHint: 'extension' },
  'bulgarian-split-squat': { label: 'Bulgarian Split Squat', group: 'Quads', emphasisHint: 'bulgarian' },
  'seated-ham-curl': { label: 'Seated Hamstring Curl', group: 'Hamstrings', emphasisHint: 'seated curl' },
  'lying-ham-curl': { label: 'Lying Hamstring Curl', group: 'Hamstrings', emphasisHint: 'curl' },
  rdl: { label: 'Romanian Deadlift', group: 'Hamstrings', emphasisHint: 'rdl' },
  'calf-raise': { label: 'Calf Raise', group: 'Calves' },
  'seated-calf-raise': { label: 'Seated Calf Raise', group: 'Calves' },
  // Core
  'cable-crunch': { label: 'Cable Crunch', group: 'Core', emphasisHint: 'crunch' },
  'oblique-crunch': { label: 'Oblique Crunch', group: 'Core', emphasisHint: 'oblique' },
  'serratus-crunch': { label: 'Serratus Crunch', group: 'Core', emphasisHint: 'serratus' },
  'leg-raise': { label: 'Hanging Leg Raise', group: 'Core', bodyweight: true, emphasisHint: 'leg raise' },
  'cable-woodchop': { label: 'Cable Woodchop', group: 'Core', emphasisHint: 'woodchop' },
};

/**
 * Map a free-text exercise name (from any era) onto its lift lineage key.
 * Returns null for things we don't score (jump rope, push-ups, ...).
 */
export function canonicalLiftKey(exerciseName: string): string | null {
  const n = exerciseName.toLowerCase().replace(/\s+/g, ' ').trim();
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  const single = has('single', 'one-arm', 'one arm');
  const dual = has('dual', 'duel', 'double');

  if (has('jump rope', 'push up', 'push-up', 'pushup', 'hip adduction', 'hip abduction', 'burn out')) return null;

  // Chest
  if (has('dip')) return 'chest-dips';
  if (has('incline') && has('db', 'dumbbell') && has('press', 'bench')) return 'incline-db-press';
  if (has('db bench', 'flat db', 'flat dumbbell', 'dumbbell bench', 'dumbbell press')) return 'flat-db-press';
  if (has('decline') && has('machine', 'press')) return 'decline-machine-press';
  if (has('flat machine', 'machine chest press')) return 'flat-machine-press';
  if (has('pec deck', 'mid chest fly machine')) return single ? 'single-arm-pec-deck' : 'pec-deck';
  if (has('reverse pec')) return 'reverse-pec-deck';
  if (has('high to low', 'h to l')) return 'high-to-low-fly';
  if (has('low to high', 'l to h')) return 'low-to-high-fly';

  // Triceps
  if (has('katana')) return 'katana-ext';
  if (has('skull')) return 'skullcrushers';
  if (has('cable ext') && dual) return 'dual-cable-ext';
  if (has('tricep', 'pushdown', 'push down', 'overhead') && !has('shoulder', 'press')) {
    if (single) return 'single-arm-tricep-ext';
    if (dual && has('extension') && !has('pushdown')) return 'dual-cable-ext';
    if (has('overhead')) return 'overhead-tricep-ext';
    if (has('pronat')) return 'pronated-pushdown';
    return 'tricep-pushdown';
  }
  if (has('single arm cable ext')) return 'single-arm-tricep-ext';

  // Back
  if (has('pull up', 'pull-up')) return 'pull-ups';
  if (has('sup bicep pulldown', 'supinated')) return 'supinated-pulldown';
  if (has('straight arm', 'straight-arm')) return 'straight-arm-pulldown';
  if (has('lat pulldown', 'lat pull')) return single ? 'single-arm-lat-pulldown' : 'lat-pulldown';
  if (has('landmine')) return 'landmine-row';
  if (has('bb row', 'barbell row')) return 'barbell-row';
  if (has('db row', 'dumbbell row')) return 'db-row';
  if (has('row')) return has('wide') ? 'wide-grip-row' : 'seated-row';
  if (has('back extension', 'hyperextension')) return 'back-extension';
  if (has('shrug')) return 'shrugs';

  // Biceps
  if (has('hammer')) return 'hammer-curl';
  if (has('preacher')) return 'preacher-curl';
  if (has('incline') && has('curl')) return has('cable') ? 'incline-cable-curl' : 'incline-db-curl';
  if (has('reverse cable curl')) return 'reverse-cable-curl';
  if (has('reverse curl')) return 'reverse-curl';
  if (has('curl') && !has('hamstring', 'leg curl')) return 'cable-curl';

  // Shoulders
  if (has('shoulder press', 'overhead press')) return 'db-shoulder-press';
  if (has('y raise', 'y-raise')) return 'cable-y-raise';
  if (has('lateral', 'laterial', 'lat raise')) return dual ? 'dual-lateral-raise' : 'cable-lateral-raise';
  if (has('face pull')) return single ? 'rear-delt-cable-fly' : 'face-pull';
  if (has('rear delt', 'rear dealt')) return 'rear-delt-cable-fly';

  // Legs
  if (has('leg press')) return 'leg-press';
  if (has('hack')) return 'hack-squat';
  if (has('quad ext', 'leg ext')) return 'leg-extension';
  if (has('bulgarian')) return 'bulgarian-split-squat';
  if (has('hamstring', 'leg curl')) return has('lying') ? 'lying-ham-curl' : 'seated-ham-curl';
  if (has('rdl', 'romanian')) return 'rdl';
  if (has('calf')) return has('seated') ? 'seated-calf-raise' : 'calf-raise';

  // Core
  if (has('cable crunch')) return 'cable-crunch';
  if (has('oblique')) return 'oblique-crunch';
  if (has('serratus')) return 'serratus-crunch';
  if (has('leg raise', 'knee raise')) return 'leg-raise';
  if (has('woodchop')) return 'cable-woodchop';
  if (has('crunch')) return 'cable-crunch';

  return null;
}

/** Short tag for a split name: "PPLs" → "PPL", "Ascend with me?" → "AWM". */
export function splitAbbreviation(splitName: string): string {
  const trimmed = splitName.trim();
  if (!trimmed) return '—';
  const lower = trimmed.toLowerCase();
  if (lower === 'ppls' || lower === 'ppl') return 'PPL';
  if (lower.startsWith('ascend')) return 'AWM';
  if (lower === 'import split') return 'IMP';
  const words = trimmed.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Epley stops meaning much past this many reps; it also defuses typo'd rep counts. */
export const SCORE_REP_CAP = 20;

/** Comparable strength score for one set (Epley, with bodyweight added for BW lifts). */
export function peakScore(weight: number, reps: number, bodyweight: boolean): number {
  const load = bodyweight ? BODYWEIGHT_LBS + weight : weight;
  if (load <= 0 || reps <= 0) return 0;
  return load * (1 + Math.min(reps, SCORE_REP_CAP) / 30);
}

/**
 * Pull-ups are logged as assistance (negative) in the app today, but early
 * sessions wrote the assist as a positive number. Nobody here is doing
 * +100 lb weighted pull-ups, so a positive load on that lineage is assist.
 */
function normalizeWeight(key: string, weight: number): number {
  if (key === 'pull-ups' && weight > 0) return -weight;
  return weight;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

interface LiftSession {
  sessionKey: string;
  date: string;
  dateEstimated: boolean;
  splitAbbr: string;
  splitName: string;
  best: { weight: number; reps: number; score: number };
}

function toPoint(s: LiftSession): PeakPoint {
  return {
    date: s.date,
    dateEstimated: s.dateEstimated,
    splitAbbr: s.splitAbbr,
    splitName: s.splitName,
    weight: s.best.weight,
    reps: s.best.reps,
    score: Number(s.best.score.toFixed(1)),
  };
}

export function computePeakReport(rows: PeakSetRow[], now: Date, recentWindowDays = RECENT_WINDOW_DAYS): PeakReport {
  const recentCutoff = now.getTime() - recentWindowDays * DAY_MS;

  // --- Split timeline ------------------------------------------------------
  const splitAcc = new Map<string, PeakSplitSummary & { sessionKeys: Set<string> }>();
  for (const row of rows) {
    const date = dateOnly(row.date);
    const entry = splitAcc.get(row.splitAbbr);
    if (entry) {
      if (date < entry.firstDate) entry.firstDate = date;
      if (date > entry.lastDate) entry.lastDate = date;
      entry.sessionKeys.add(row.sessionKey);
    } else {
      splitAcc.set(row.splitAbbr, {
        abbr: row.splitAbbr,
        name: row.splitName,
        firstDate: date,
        lastDate: date,
        sessions: 0,
        source: row.source,
        sessionKeys: new Set([row.sessionKey]),
      });
    }
  }
  const splits: PeakSplitSummary[] = [...splitAcc.values()]
    .map(({ sessionKeys, ...s }) => ({ ...s, sessions: sessionKeys.size }))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  const splitOrder = new Map(splits.map((s, i) => [s.abbr, i]));

  // --- Best set per (lift, session) ---------------------------------------
  const liftSessions = new Map<string, Map<string, LiftSession>>();
  for (const row of rows) {
    if (row.excluded) continue;
    const key = canonicalLiftKey(row.exerciseName);
    if (!key) continue;
    const def = LIFTS[key];
    const weight = normalizeWeight(key, row.weight);
    const score = peakScore(weight, row.reps, def.bodyweight === true);
    if (score <= 0) continue;
    let sessions = liftSessions.get(key);
    if (!sessions) {
      sessions = new Map();
      liftSessions.set(key, sessions);
    }
    const existing = sessions.get(row.sessionKey);
    if (!existing) {
      sessions.set(row.sessionKey, {
        sessionKey: row.sessionKey,
        date: dateOnly(row.date),
        dateEstimated: row.dateEstimated,
        splitAbbr: row.splitAbbr,
        splitName: row.splitName,
        best: { weight, reps: row.reps, score },
      });
    } else if (score > existing.best.score) {
      existing.best = { weight, reps: row.reps, score };
    }
  }

  // --- Per-lift summaries --------------------------------------------------
  const lifts: PeakLiftSummary[] = [];
  for (const [key, sessions] of liftSessions) {
    const def = LIFTS[key];
    const ordered = [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (ordered.length === 0) continue;

    let peak = ordered[0];
    for (const s of ordered) if (s.best.score > peak.best.score) peak = s;

    const latest = ordered[ordered.length - 1];
    const recent = ordered.filter((s) => new Date(s.date).getTime() >= recentCutoff);
    // "Current" is the most recent session, good day or bad — the owner wants
    // to see a weak session for what it is. A lift that hasn't been trained
    // inside the recent window is marked stale so it stays out of the
    // group roll-ups.
    const current = latest;
    const stale = recent.length === 0;

    const bestBySplit = new Map<string, LiftSession>();
    for (const s of ordered) {
      const existing = bestBySplit.get(s.splitAbbr);
      if (!existing || s.best.score > existing.best.score) bestBySplit.set(s.splitAbbr, s);
    }
    const bySplit = [...bestBySplit.values()]
      .sort((a, b) => (splitOrder.get(a.splitAbbr) ?? 0) - (splitOrder.get(b.splitAbbr) ?? 0))
      .map(toPoint);

    const pct = peak.best.score > 0 ? Math.min(100, (current.best.score / peak.best.score) * 100) : 0;
    lifts.push({
      key,
      label: def.label,
      group: def.group,
      bodyweight: def.bodyweight === true,
      current: toPoint(current),
      peak: toPoint(peak),
      pctOfPeak: Number(pct.toFixed(1)),
      stale,
      atPeak: !stale && current.sessionKey === peak.sessionKey,
      sessions: ordered.length,
      firstTrained: ordered[0].date,
      lastTrained: latest.date,
      bySplit,
    });
  }

  // --- Group + head roll-ups ------------------------------------------------
  const groups: PeakGroupSummary[] = [];
  for (const group of MUSCLE_GROUPS) {
    const groupLifts = lifts
      .filter((l) => l.group === group)
      .sort((a, b) => {
        if (a.stale !== b.stale) return a.stale ? 1 : -1;
        return b.peak.score - a.peak.score;
      });
    if (groupLifts.length === 0) continue;

    const heads = MUSCLE_HEADS[group];
    const headNum = heads.map(() => 0);
    const headDen = heads.map(() => 0);
    const headLifts = heads.map(() => [] as string[]);
    let groupNum = 0;
    let groupDen = 0;
    const eraCount = new Map<string, number>();

    for (const lift of groupLifts) {
      eraCount.set(lift.peak.splitAbbr, (eraCount.get(lift.peak.splitAbbr) ?? 0) + 1);
      if (lift.stale) continue;
      const emphasis = headEmphasis(group, LIFTS[lift.key].emphasisHint ?? lift.label);
      const ratio = lift.pctOfPeak / 100;
      emphasis.forEach((e, i) => {
        if (e <= 0) return;
        headNum[i] += e * ratio;
        headDen[i] += e;
        headLifts[i].push(lift.key);
        groupNum += e * ratio;
        groupDen += e;
      });
    }

    let peakEra: string | null = null;
    let peakEraCount = 0;
    for (const [abbr, count] of eraCount) {
      if (count > peakEraCount) {
        peakEra = abbr;
        peakEraCount = count;
      }
    }

    groups.push({
      group,
      pctOfPeak: groupDen > 0 ? Number(((groupNum / groupDen) * 100).toFixed(1)) : null,
      activeLifts: groupLifts.filter((l) => !l.stale).length,
      totalLifts: groupLifts.length,
      atPeakCount: groupLifts.filter((l) => l.atPeak).length,
      peakEra,
      heads: heads.map((head, i) => ({
        head,
        pctOfPeak: headDen[i] > 0 ? Number(((headNum[i] / headDen[i]) * 100).toFixed(1)) : null,
        liftKeys: headLifts[i],
      })),
      lifts: groupLifts,
    });
  }

  const active = lifts.filter((l) => !l.stale);
  const overall =
    active.length > 0
      ? Number((active.reduce((s, l) => s + l.pctOfPeak, 0) / active.length).toFixed(1))
      : null;

  const allDates = rows.map((r) => dateOnly(r.date)).sort();
  return {
    overallPctOfPeak: overall,
    activeLifts: active.length,
    liftsAtPeak: active.filter((l) => l.atPeak).length,
    totalLifts: lifts.length,
    firstDate: allDates[0] ?? null,
    recentWindowDays,
    splits,
    groups,
  };
}
