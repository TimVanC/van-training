/**
 * A split as proposed by the onboarding coach and edited by the user before
 * it is saved. Pure module shared by the API functions and the client.
 */

export interface DraftExercise {
  name: string;
  sets: number;
  repRange: string;
}

export interface DraftDay {
  name: string;
  exercises: DraftExercise[];
}

export interface SplitDraft {
  name: string;
  days: DraftDay[];
}

export const MAX_DAYS = 10;
export const MAX_EXERCISES_PER_DAY = 20;
export const MAX_SETS = 10;
const MAX_SPLIT_NAME = 60;
const MAX_DAY_NAME = 40;
const MAX_EXERCISE_NAME = 80;
const MAX_REP_RANGE = 12;
const DEFAULT_REP_RANGE = '8-12';
const DEFAULT_SETS = 3;

/** Split names the app reserves for its own bookkeeping. */
const RESERVED_SPLIT_NAMES = ['import split'];

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanSets(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SETS;
  return Math.min(n, MAX_SETS);
}

/** Accepts "8-12", "8 to 12", "10", "12–15"; anything else gets the default. */
function cleanRepRange(value: unknown): string {
  const text = cleanText(typeof value === 'number' ? String(value) : value, MAX_REP_RANGE)
    .replace(/[–—]|\s+to\s+/gi, '-')
    .replace(/\s+/g, '');
  const match = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(text);
  if (!match) return DEFAULT_REP_RANGE;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  if (low < 1 || high < low) return DEFAULT_REP_RANGE;
  return high === low ? String(low) : `${low}-${high}`;
}

/**
 * Normalize untrusted input (model output or a client payload) into a draft
 * that is safe to save: trimmed names, bounded sizes, unique day names.
 * Empty days and unnamed exercises are dropped rather than rejected.
 */
export function sanitizeSplitDraft(input: unknown): { draft: SplitDraft } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'No split to save.' };
  const raw = input as { name?: unknown; days?: unknown };

  const name = cleanText(raw.name, MAX_SPLIT_NAME);
  if (!name) return { error: 'Give your split a name.' };
  if (RESERVED_SPLIT_NAMES.includes(name.toLowerCase())) {
    return { error: `"${name}" is a reserved name. Pick another.` };
  }

  if (!Array.isArray(raw.days)) return { error: 'Your split needs at least one day.' };
  const days: DraftDay[] = [];
  const seenDays = new Set<string>();
  for (const rawDay of raw.days.slice(0, MAX_DAYS)) {
    if (!rawDay || typeof rawDay !== 'object') continue;
    const d = rawDay as { name?: unknown; exercises?: unknown };
    const exercises: DraftExercise[] = [];
    const seenExercises = new Set<string>();
    for (const rawEx of Array.isArray(d.exercises) ? d.exercises.slice(0, MAX_EXERCISES_PER_DAY) : []) {
      if (!rawEx || typeof rawEx !== 'object') continue;
      const e = rawEx as { name?: unknown; sets?: unknown; repRange?: unknown };
      const exName = cleanText(e.name, MAX_EXERCISE_NAME);
      if (!exName || seenExercises.has(exName.toLowerCase())) continue;
      seenExercises.add(exName.toLowerCase());
      exercises.push({ name: exName, sets: cleanSets(e.sets), repRange: cleanRepRange(e.repRange) });
    }
    if (exercises.length === 0) continue;

    let dayName = cleanText(d.name, MAX_DAY_NAME) || `Day ${days.length + 1}`;
    if (seenDays.has(dayName.toLowerCase())) {
      let suffix = 2;
      while (seenDays.has(`${dayName} ${suffix}`.toLowerCase())) suffix += 1;
      dayName = `${dayName} ${suffix}`;
    }
    seenDays.add(dayName.toLowerCase());
    days.push({ name: dayName, exercises });
  }

  if (days.length === 0) return { error: 'Your split needs at least one day with an exercise.' };
  return { draft: { name, days } };
}
