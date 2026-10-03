/**
 * Read-only views over a lifter's logged sets, shaped for the in-app coach:
 * small, already-summarized answers the model can reason about without ever
 * seeing the raw table. Pure module shared by the API function and tests.
 */

import { MUSCLE_GROUPS, classifyExercise, type MuscleGroup } from './muscles.js';

export interface CoachSetRow {
  sessionId: string;
  /** ISO date or timestamp of the session. */
  date: string;
  splitName: string;
  dayName: string;
  exercise: string;
  weight: number;
  reps: number;
  setNumber: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dateOnly = (iso: string): string => iso.slice(0, 10);
const round = (n: number, places = 0): number => Number(n.toFixed(places));

/** Epley estimate; only meaningful for positive loads. */
export function estimatedOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + Math.min(reps, 20) / 30);
}

function formatSet(weight: number, reps: number): string {
  const w = Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
  return `${w}x${reps}`;
}

function bySetOrder(a: CoachSetRow, b: CoachSetRow): number {
  return (a.setNumber ?? 0) - (b.setNumber ?? 0);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export interface ExerciseOverview {
  exercise: string;
  sessions: number;
  sets: number;
  firstDate: string;
  lastDate: string;
  bestSet: string;
}

/** Every exercise the lifter has logged, most recently trained first. */
export function listExercises(rows: CoachSetRow[]): ExerciseOverview[] {
  const out: ExerciseOverview[] = [];
  for (const [exercise, sets] of groupBy(rows, (r) => r.exercise)) {
    const dates = sets.map((s) => dateOnly(s.date)).sort();
    let best = sets[0];
    for (const s of sets) {
      if (estimatedOneRepMax(s.weight, s.reps) > estimatedOneRepMax(best.weight, best.reps)) best = s;
    }
    out.push({
      exercise,
      sessions: new Set(sets.map((s) => s.sessionId)).size,
      sets: sets.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      bestSet: formatSet(best.weight, best.reps),
    });
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.sessions - a.sessions);
}

/**
 * Resolve what the lifter (or the model) called an exercise to a logged name:
 * exact match, then substring, then the best word overlap.
 */
export function matchExercise(rows: CoachSetRow[], query: string): string | null {
  const names = [...new Set(rows.map((r) => r.exercise))];
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = names.find((n) => n.toLowerCase() === q);
  if (exact) return exact;
  const contains = names.filter((n) => n.toLowerCase().includes(q) || q.includes(n.toLowerCase()));
  if (contains.length > 0) return contains.sort((a, b) => a.length - b.length)[0];

  const words = (text: string) => text.toLowerCase().replace(/s\b/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const wanted = words(q);
  let bestName: string | null = null;
  let bestScore = 0;
  for (const name of names) {
    const have = new Set(words(name));
    const score = wanted.filter((w) => have.has(w)).length / Math.max(wanted.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }
  return bestScore >= 0.5 ? bestName : null;
}

export interface ExerciseSessionPoint {
  date: string;
  day: string;
  sets: string;
  topWeight: number;
  topReps: number;
  estimated1RM: number;
  volume: number;
}

/** One exercise, session by session (oldest first), limited to the latest `limit`. */
export function exerciseHistory(
  rows: CoachSetRow[],
  query: string,
  limit: number,
): { exercise: string | null; totalSessions: number; sessions: ExerciseSessionPoint[] } {
  const exercise = matchExercise(rows, query);
  if (!exercise) return { exercise: null, totalSessions: 0, sessions: [] };
  const sessions: ExerciseSessionPoint[] = [];
  for (const sets of groupBy(rows.filter((r) => r.exercise === exercise), (r) => r.sessionId).values()) {
    const ordered = [...sets].sort(bySetOrder);
    let top = ordered[0];
    for (const s of ordered) {
      if (estimatedOneRepMax(s.weight, s.reps) > estimatedOneRepMax(top.weight, top.reps)) top = s;
    }
    sessions.push({
      date: dateOnly(ordered[0].date),
      day: ordered[0].dayName,
      sets: ordered.map((s) => formatSet(s.weight, s.reps)).join(', '),
      topWeight: top.weight,
      topReps: top.reps,
      estimated1RM: round(estimatedOneRepMax(top.weight, top.reps), 1),
      volume: round(ordered.reduce((sum, s) => sum + s.weight * s.reps, 0)),
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return { exercise, totalSessions: sessions.length, sessions: sessions.slice(-limit) };
}

export interface SessionOverview {
  date: string;
  split: string;
  day: string;
  exercises: Array<{ name: string; sets: string }>;
}

/** The latest `limit` sessions, newest first, with every set. */
export function recentSessions(rows: CoachSetRow[], limit: number): SessionOverview[] {
  const sessions: SessionOverview[] = [];
  for (const sets of groupBy(rows, (r) => r.sessionId).values()) {
    const exercises: SessionOverview['exercises'] = [];
    for (const [name, exSets] of groupBy(sets, (r) => r.exercise)) {
      exercises.push({ name, sets: [...exSets].sort(bySetOrder).map((s) => formatSet(s.weight, s.reps)).join(', ') });
    }
    sessions.push({ date: dateOnly(sets[0].date), split: sets[0].splitName, day: sets[0].dayName, exercises });
  }
  return sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** Monday of the week containing `date`, as YYYY-MM-DD (UTC). */
function weekStart(date: string): string {
  const d = new Date(`${dateOnly(date)}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export interface WeekOverview {
  weekOf: string;
  sessions: number;
  sets: number;
  volume: number;
}

/** Sessions, sets and volume for each of the last `weeks` weeks (oldest first), including empty weeks. */
export function weeklySummary(rows: CoachSetRow[], weeks: number, now: Date): WeekOverview[] {
  const currentWeek = weekStart(now.toISOString());
  const out: WeekOverview[] = [];
  const byWeek = groupBy(rows, (r) => weekStart(r.date));
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekOf = new Date(new Date(`${currentWeek}T00:00:00Z`).getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10);
    const sets = byWeek.get(weekOf) ?? [];
    out.push({
      weekOf,
      sessions: new Set(sets.map((s) => s.sessionId)).size,
      sets: sets.length,
      volume: round(sets.reduce((sum, s) => sum + Math.max(s.weight, 0) * s.reps, 0)),
    });
  }
  return out;
}

export interface MuscleOverview {
  group: MuscleGroup;
  sets: number;
  setsPerWeek: number;
  topExercises: string[];
}

/** Hard sets per muscle group (by each exercise's primary muscle) over the last `weeks` weeks. */
export function muscleSummary(rows: CoachSetRow[], weeks: number, now: Date): MuscleOverview[] {
  const cutoff = new Date(now.getTime() - weeks * 7 * DAY_MS).toISOString().slice(0, 10);
  const recent = rows.filter((r) => dateOnly(r.date) >= cutoff);
  const out: MuscleOverview[] = [];
  for (const group of MUSCLE_GROUPS) {
    const sets = recent.filter((r) => classifyExercise(r.exercise)?.primary === group);
    const counts = [...groupBy(sets, (r) => r.exercise)].sort((a, b) => b[1].length - a[1].length);
    out.push({
      group,
      sets: sets.length,
      setsPerWeek: round(sets.length / weeks, 1),
      topExercises: counts.slice(0, 3).map(([name]) => name),
    });
  }
  return out;
}

export interface RecordOverview {
  exercise: string;
  bestSet: string;
  estimated1RM: number;
  date: string;
  /** True when the record was set in the most recent session for that lift. */
  isLatestSession: boolean;
}

/** Best set (by estimated 1RM) for every exercise, strongest first. */
export function personalRecords(rows: CoachSetRow[]): RecordOverview[] {
  const out: RecordOverview[] = [];
  for (const [exercise, sets] of groupBy(rows, (r) => r.exercise)) {
    let best: CoachSetRow | null = null;
    for (const s of sets) {
      if (estimatedOneRepMax(s.weight, s.reps) <= 0) continue;
      if (!best || estimatedOneRepMax(s.weight, s.reps) > estimatedOneRepMax(best.weight, best.reps)) best = s;
    }
    if (!best) continue;
    const lastDate = sets.map((s) => dateOnly(s.date)).sort().pop();
    out.push({
      exercise,
      bestSet: formatSet(best.weight, best.reps),
      estimated1RM: round(estimatedOneRepMax(best.weight, best.reps), 1),
      date: dateOnly(best.date),
      isLatestSession: dateOnly(best.date) === lastDate,
    });
  }
  return out.sort((a, b) => b.estimated1RM - a.estimated1RM);
}
