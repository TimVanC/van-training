/**
 * Training analysis: muscle-group trends, check-in insights, PRs, streaks.
 *
 * Pure module — the dashboard API feeds it raw rows and it returns
 * display-ready judgments. Shared between server and client so numbers always
 * agree.
 */

import { MUSCLE_GROUPS, classifyExercise, type MuscleGroup } from './muscles.js';
import { estimateOneRepMax } from './progression.js';

export interface AnalysisSetRow {
  sessionId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  rir: number;
}

export interface AnalysisSessionRow {
  id: string;
  /** ISO timestamp. */
  date: string;
  dayName: string;
  splitName: string;
}

export interface CheckinRow {
  sessionDate: string; // YYYY-MM-DD
  feel: number | null;
  effort: number | null;
  sleep: number | null;
  soreness: number | null;
  dietQuality: number | null;
  tookPreworkout: boolean | null;
}

export type TrendVerdict = 'progressing' | 'steady' | 'plateaued' | 'regressing' | 'insufficient';

export interface ExerciseTrend {
  name: string;
  /** Percent e1RM change per week over the analysis window. */
  slopePctPerWeek: number;
  sessions: number;
  lastTop: { weight: number; reps: number; date: string };
  /** Best-set e1RM per session, oldest first, for sparklines. */
  series: Array<{ date: string; e1rm: number }>;
}

export interface MuscleGroupSummary {
  name: MuscleGroup;
  verdict: TrendVerdict;
  /** Volume-weighted percent e1RM change per week (0 when insufficient). */
  slopePctPerWeek: number;
  /** Working sets per ISO week for the last 8 weeks, oldest first. */
  weeklySets: Array<{ weekStart: string; sets: number }>;
  exercises: ExerciseTrend[];
  bestMover?: { name: string; slopePctPerWeek: number };
  worstMover?: { name: string; slopePctPerWeek: number };
}

export interface CheckinInsight {
  kind: 'sleep' | 'preworkout' | 'diet' | 'soreness' | 'consistency';
  title: string;
  detail: string;
  /** Signed percent difference backing the insight, when applicable. */
  deltaPct?: number;
}

export interface PrEntry {
  exerciseName: string;
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Monday of the ISO week containing the given date. */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** Least-squares slope of y over x. Returns 0 for fewer than 2 points. */
function linearSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

interface SessionLookup {
  byId: Map<string, AnalysisSessionRow>;
}

function buildLookup(sessions: AnalysisSessionRow[]): SessionLookup {
  return { byId: new Map(sessions.map((s) => [s.id, s])) };
}

/**
 * Per-exercise trend: best-set e1RM per session, regressed over time and
 * expressed as percent-of-average per week so exercises of different absolute
 * strength are comparable.
 */
function computeExerciseTrend(
  name: string,
  sets: AnalysisSetRow[],
  lookup: SessionLookup,
  windowDays: number,
  now: Date,
): ExerciseTrend | null {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const bySession = new Map<string, { date: string; e1rm: number; top: { weight: number; reps: number } }>();

  for (const set of sets) {
    if (set.weight <= 0 || set.reps <= 0) continue;
    const session = lookup.byId.get(set.sessionId);
    if (!session) continue;
    const t = new Date(session.date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const e1rm = estimateOneRepMax(set.weight, set.reps);
    const existing = bySession.get(set.sessionId);
    if (!existing || e1rm > existing.e1rm) {
      bySession.set(set.sessionId, {
        date: session.date,
        e1rm,
        top: { weight: set.weight, reps: set.reps },
      });
    }
  }

  const series = [...bySession.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (series.length === 0) return null;

  const mean = series.reduce((s, p) => s + p.e1rm, 0) / series.length;
  const t0 = new Date(series[0].date).getTime();
  const slopePerDay = linearSlope(
    series.map((p) => ({ x: (new Date(p.date).getTime() - t0) / DAY_MS, y: p.e1rm })),
  );
  const slopePctPerWeek = mean > 0 ? ((slopePerDay * 7) / mean) * 100 : 0;
  const last = series[series.length - 1];

  return {
    name,
    slopePctPerWeek: Number(slopePctPerWeek.toFixed(2)),
    sessions: series.length,
    lastTop: { weight: last.top.weight, reps: last.top.reps, date: dateOnly(last.date) },
    series: series.map((p) => ({ date: dateOnly(p.date), e1rm: Number(p.e1rm.toFixed(1)) })),
  };
}

function verdictFor(slope: number, totalSessions: number, spanWeeks: number): TrendVerdict {
  if (totalSessions < 3) return 'insufficient';
  if (slope >= 0.4) return 'progressing';
  if (slope <= -0.6) return 'regressing';
  if (spanWeeks >= 3 && Math.abs(slope) < 0.4) return 'plateaued';
  return 'steady';
}

/**
 * Plain-English reason for a group's verdict, shown when the card is expanded.
 * Wording must stay in sync with the thresholds in `verdictFor` above.
 */
export function verdictExplanation(summary: {
  verdict: TrendVerdict;
  slopePctPerWeek: number;
  bestMover?: { name: string; slopePctPerWeek: number };
  worstMover?: { name: string; slopePctPerWeek: number };
}): string {
  const { verdict, slopePctPerWeek, bestMover, worstMover } = summary;
  const pct = Math.abs(slopePctPerWeek).toFixed(1);
  switch (verdict) {
    case 'progressing':
      return (
        `Your estimated strength across this group is climbing about ${pct}% per week ` +
        `(anything over 0.4%/wk counts as progressing)` +
        (bestMover ? ` — ${bestMover.name} is leading the way at ${bestMover.slopePctPerWeek > 0 ? '+' : ''}${bestMover.slopePctPerWeek.toFixed(1)}%/wk.` : '.')
      );
    case 'regressing':
      return (
        `Your estimated strength here is dropping about ${pct}% per week over the recent window` +
        (worstMover ? ` — ${worstMover.name} is sliding fastest (${worstMover.slopePctPerWeek.toFixed(1)}%/wk). ` : '. ') +
        `Check recovery, sleep, and whether loads got cut.`
      );
    case 'plateaued':
      return (
        `Strength has been flat (within ±0.4%/wk) for 3+ weeks of training. ` +
        `That usually means it's time to change a rep range, swap a variation, or take a deload.`
      );
    case 'steady':
      return (
        `Change is inside the noise band (between −0.6 and +0.4%/wk) and the trend window is still short — ` +
        `holding ground, not yet a plateau.`
      );
    case 'insufficient':
      return `Not enough data yet — a trend needs at least 3 logged sessions per exercise in the last 8 weeks.`;
  }
}

export function summarizeMuscleGroups(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
  now: Date,
  windowDays = 56,
): MuscleGroupSummary[] {
  const lookup = buildLookup(sessions);

  // Bucket sets by exercise, and count weekly working sets per muscle group.
  const setsByExercise = new Map<string, AnalysisSetRow[]>();
  const weeklySetsByGroup = new Map<MuscleGroup, Map<string, number>>();
  for (const g of MUSCLE_GROUPS) weeklySetsByGroup.set(g, new Map());

  const eightWeeksAgo = now.getTime() - 8 * 7 * DAY_MS;
  for (const set of sets) {
    const list = setsByExercise.get(set.exerciseName);
    if (list) list.push(set);
    else setsByExercise.set(set.exerciseName, [set]);

    const session = lookup.byId.get(set.sessionId);
    if (!session) continue;
    const t = new Date(session.date).getTime();
    if (!Number.isFinite(t) || t < eightWeeksAgo) continue;
    const week = isoWeekStart(new Date(session.date));
    const cls = classifyExercise(set.exerciseName);
    if (!cls) continue;
    const primaryMap = weeklySetsByGroup.get(cls.primary)!;
    primaryMap.set(week, (primaryMap.get(week) ?? 0) + 1);
    for (const secondary of cls.secondary) {
      const secMap = weeklySetsByGroup.get(secondary)!;
      secMap.set(week, (secMap.get(week) ?? 0) + 0.5);
    }
  }

  // Trends per exercise, grouped by primary muscle.
  const trendsByGroup = new Map<MuscleGroup, ExerciseTrend[]>();
  for (const [exerciseName, exerciseSets] of setsByExercise) {
    const cls = classifyExercise(exerciseName);
    if (!cls) continue;
    const trend = computeExerciseTrend(exerciseName, exerciseSets, lookup, windowDays, now);
    if (!trend) continue;
    const list = trendsByGroup.get(cls.primary);
    if (list) list.push(trend);
    else trendsByGroup.set(cls.primary, [trend]);
  }

  // Last 8 ISO week starts, oldest first.
  const weekStarts: string[] = [];
  for (let i = 7; i >= 0; i--) {
    weekStarts.push(isoWeekStart(new Date(now.getTime() - i * 7 * DAY_MS)));
  }

  const summaries: MuscleGroupSummary[] = [];
  for (const group of MUSCLE_GROUPS) {
    const trends = (trendsByGroup.get(group) ?? []).sort((a, b) => b.sessions - a.sessions);
    const weekMap = weeklySetsByGroup.get(group)!;
    const weeklySets = weekStarts.map((weekStart) => ({
      weekStart,
      sets: Number((weekMap.get(weekStart) ?? 0).toFixed(1)),
    }));

    // Skip groups that have never been trained at all.
    const everTrained = trends.length > 0 || weeklySets.some((w) => w.sets > 0);
    if (!everTrained) continue;

    const trended = trends.filter((t) => t.sessions >= 3);
    const totalSessions = trended.reduce((s, t) => s + t.sessions, 0);
    const weightedSlope =
      totalSessions > 0
        ? trended.reduce((s, t) => s + t.slopePctPerWeek * t.sessions, 0) / totalSessions
        : 0;

    let spanWeeks = 0;
    if (trended.length > 0) {
      const allDates = trended.flatMap((t) => t.series.map((p) => p.date)).sort();
      spanWeeks =
        (new Date(allDates[allDates.length - 1]).getTime() - new Date(allDates[0]).getTime()) /
        (7 * DAY_MS);
    }

    const verdict = trended.length === 0 ? 'insufficient' : verdictFor(weightedSlope, totalSessions, spanWeeks);
    const movers = [...trended].sort((a, b) => b.slopePctPerWeek - a.slopePctPerWeek);

    summaries.push({
      name: group,
      verdict,
      slopePctPerWeek: Number(weightedSlope.toFixed(2)),
      weeklySets,
      exercises: trends,
      bestMover: movers[0] ? { name: movers[0].name, slopePctPerWeek: movers[0].slopePctPerWeek } : undefined,
      worstMover:
        movers.length > 1
          ? { name: movers[movers.length - 1].name, slopePctPerWeek: movers[movers.length - 1].slopePctPerWeek }
          : undefined,
    });
  }

  return summaries;
}

/** All-time PR feed: sessions whose best set beat every earlier e1RM for that exercise. */
export function computeRecentPrs(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
  now: Date,
  windowDays = 45,
  limit = 12,
): PrEntry[] {
  const bySession = new Map<string, Map<string, { weight: number; reps: number; e1rm: number }>>();

  for (const set of sets) {
    if (set.weight <= 0 || set.reps <= 0) continue;
    const e1rm = estimateOneRepMax(set.weight, set.reps);
    let sessionMap = bySession.get(set.sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      bySession.set(set.sessionId, sessionMap);
    }
    const existing = sessionMap.get(set.exerciseName);
    if (!existing || e1rm > existing.e1rm) {
      sessionMap.set(set.exerciseName, { weight: set.weight, reps: set.reps, e1rm });
    }
  }

  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const bestSoFar = new Map<string, number>();
  const prs: PrEntry[] = [];
  const cutoff = now.getTime() - windowDays * DAY_MS;

  for (const session of ordered) {
    const sessionMap = bySession.get(session.id);
    if (!sessionMap) continue;
    for (const [exerciseName, top] of sessionMap) {
      const prev = bestSoFar.get(exerciseName) ?? 0;
      if (top.e1rm > prev) {
        bestSoFar.set(exerciseName, top.e1rm);
        // Only count as a "recent PR" if there was history to beat.
        if (prev > 0 && new Date(session.date).getTime() >= cutoff) {
          prs.push({
            exerciseName,
            date: dateOnly(session.date),
            weight: top.weight,
            reps: top.reps,
            e1rm: Number(top.e1rm.toFixed(1)),
          });
        }
      }
    }
  }

  return prs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

interface VolumeByDate {
  get(date: string): number | undefined;
}

function buildVolumeByDate(sessions: AnalysisSessionRow[], sets: AnalysisSetRow[]): VolumeByDate {
  const sessionDate = new Map(sessions.map((s) => [s.id, dateOnly(s.date)]));
  const volume = new Map<string, number>();
  for (const set of sets) {
    const date = sessionDate.get(set.sessionId);
    if (!date) continue;
    volume.set(date, (volume.get(date) ?? 0) + Math.max(0, set.weight) * set.reps);
  }
  return volume;
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

function pctDiff(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

/**
 * Turns check-in answers into concrete, data-backed insights by splitting
 * training days into buckets (good sleep vs bad, preworkout vs not, ...) and
 * comparing performance between them. Performance is each session's volume
 * relative to the average volume for that same workout day (Push A vs Push A),
 * so heavy leg days don't masquerade as a sleep effect. Requires at least 3
 * sessions per bucket before it will claim anything.
 */
export function buildCheckinInsights(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
  checkins: CheckinRow[],
): CheckinInsight[] {
  const insights: CheckinInsight[] = [];

  // Volume per session, then average volume per day name.
  const volumeBySessionId = new Map<string, number>();
  for (const set of sets) {
    volumeBySessionId.set(
      set.sessionId,
      (volumeBySessionId.get(set.sessionId) ?? 0) + Math.max(0, set.weight) * set.reps,
    );
  }
  const volumesByDayName = new Map<string, number[]>();
  for (const session of sessions) {
    const volume = volumeBySessionId.get(session.id) ?? 0;
    if (volume <= 0) continue;
    const list = volumesByDayName.get(session.dayName);
    if (list) list.push(volume);
    else volumesByDayName.set(session.dayName, [volume]);
  }
  const avgByDayName = new Map<string, number>();
  for (const [dayName, volumes] of volumesByDayName) {
    avgByDayName.set(dayName, avg(volumes));
  }

  // Relative performance per date: volume / typical volume for that day type.
  const relativeByDate = new Map<string, number>();
  for (const session of sessions) {
    const volume = volumeBySessionId.get(session.id) ?? 0;
    const typical = avgByDayName.get(session.dayName) ?? 0;
    if (volume <= 0 || typical <= 0) continue;
    relativeByDate.set(dateOnly(session.date), volume / typical);
  }

  const withPerformance = checkins
    .map((c) => ({ ...c, relative: relativeByDate.get(c.sessionDate) ?? 0 }))
    .filter((c) => c.relative > 0);

  const MIN_BUCKET = 3;

  function compareBuckets(
    kind: CheckinInsight['kind'],
    label: string,
    inBucket: (c: (typeof withPerformance)[number]) => boolean | null,
    highLabel: string,
    lowLabel: string,
  ): void {
    const high: number[] = [];
    const low: number[] = [];
    for (const c of withPerformance) {
      const b = inBucket(c);
      if (b === true) high.push(c.relative);
      else if (b === false) low.push(c.relative);
    }
    if (high.length < MIN_BUCKET || low.length < MIN_BUCKET) return;
    const delta = pctDiff(avg(high), avg(low));
    if (Math.abs(delta) < 4) return; // too small to be worth claiming
    const direction = delta > 0 ? 'above' : 'below';
    insights.push({
      kind,
      title: label,
      detail: `On ${highLabel} days you perform ${Math.abs(Math.round(delta))}% ${direction} your norm for the same workout, compared to ${lowLabel} days (${high.length} vs ${low.length} sessions).`,
      deltaPct: Number(delta.toFixed(1)),
    });
  }

  compareBuckets(
    'sleep',
    'Sleep is showing up in your lifting',
    (c) => (c.sleep == null ? null : c.sleep >= 7 ? true : c.sleep <= 6 ? false : null),
    'good-sleep (7+)',
    'poor-sleep',
  );
  compareBuckets(
    'preworkout',
    'Pre-workout effect',
    (c) => c.tookPreworkout,
    'pre-workout',
    'no pre-workout',
  );
  compareBuckets(
    'diet',
    'Diet quality effect',
    (c) => (c.dietQuality == null ? null : c.dietQuality >= 7 ? true : c.dietQuality <= 6 ? false : null),
    'well-fed (7+)',
    'lower diet-quality',
  );
  compareBuckets(
    'soreness',
    'Training through soreness',
    (c) => (c.soreness == null ? null : c.soreness >= 6 ? true : c.soreness <= 3 ? false : null),
    'high-soreness',
    'fresh',
  );

  return insights;
}

export interface WeekStats {
  sessionsThisWeek: number;
  sessionsLastWeek: number;
  volumeThisWeek: number;
  volumeLastWeek: number;
  /**
   * Last week's volume counting only the portion already elapsed this week
   * (Monday through this same weekday/time), so a Thursday comparison is
   * Mon–Thu vs Mon–Thu instead of a part-week vs a full week.
   */
  volumeLastWeekToDate: number;
  /** Consecutive calendar weeks (including this one) with at least one session. */
  weekStreak: number;
  totalSessions: number;
  firstSessionDate?: string;
}

export function computeWeekStats(
  sessions: AnalysisSessionRow[],
  sets: AnalysisSetRow[],
  now: Date,
): WeekStats {
  const volumeByDate = buildVolumeByDate(sessions, sets);
  const thisWeek = isoWeekStart(now);
  const lastWeek = isoWeekStart(new Date(now.getTime() - 7 * DAY_MS));

  let sessionsThisWeek = 0;
  let sessionsLastWeek = 0;
  let volumeThisWeek = 0;
  let volumeLastWeek = 0;
  let volumeLastWeekToDate = 0;
  const trainedWeeks = new Set<string>();
  // "This point in the week, one week ago" — sessions after this moment last
  // week hadn't happened yet at the equivalent time, so a to-date comparison
  // must exclude them.
  const sameTimeLastWeek = now.getTime() - 7 * DAY_MS;

  for (const session of sessions) {
    const date = dateOnly(session.date);
    const week = isoWeekStart(new Date(session.date));
    trainedWeeks.add(week);
    if (week === thisWeek) {
      sessionsThisWeek += 1;
      volumeThisWeek += volumeByDate.get(date) ?? 0;
    } else if (week === lastWeek) {
      sessionsLastWeek += 1;
      const dayVolume = volumeByDate.get(date) ?? 0;
      volumeLastWeek += dayVolume;
      if (new Date(session.date).getTime() <= sameTimeLastWeek) {
        volumeLastWeekToDate += dayVolume;
      }
    }
  }

  // Walk backwards from this week counting consecutive trained weeks. The
  // current week doesn't break the streak if it just hasn't been trained yet.
  let weekStreak = 0;
  let cursor = trainedWeeks.has(thisWeek) ? thisWeek : lastWeek;
  while (trainedWeeks.has(cursor)) {
    weekStreak += 1;
    cursor = isoWeekStart(new Date(new Date(cursor).getTime() - 7 * DAY_MS + DAY_MS / 2));
  }

  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  return {
    sessionsThisWeek,
    sessionsLastWeek,
    volumeThisWeek: Math.round(volumeThisWeek),
    volumeLastWeek: Math.round(volumeLastWeek),
    volumeLastWeekToDate: Math.round(volumeLastWeekToDate),
    weekStreak,
    totalSessions: sessions.length,
    firstSessionDate: ordered[0] ? dateOnly(ordered[0].date) : undefined,
  };
}
