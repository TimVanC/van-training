import type { Exercise, Split } from '../types/lift';
import { usesPlateInputMode } from './plateModeExercises';

const EXPECTED_DAY_ORDER = [
  'Push A',
  'Pull A',
  'Legs + Shoulders',
  'Push B',
  'Pull B',
  'Legs',
] as const;

interface ParsedCsvRow {
  day: string;
  exercise: string;
  sets: number;
  repRange: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  fields.push(current.trim());
  return fields;
}

function normalizeRows(csvText: string): ParsedCsvRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) return [];

  const rows: ParsedCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const day = (cols[0] ?? '').trim();
    const exercise = (cols[1] ?? '').trim();
    const setsRaw = (cols[2] ?? '').trim();
    const repRange = (cols[3] ?? '').trim();
    const sets = Number(setsRaw);

    if (!day || !exercise || !repRange || !Number.isFinite(sets)) continue;
    rows.push({ day, exercise, sets, repRange });
  }

  return rows;
}

function toExercise(row: ParsedCsvRow): Exercise {
  if (usesPlateInputMode(row.exercise)) {
    return {
      exercise: row.exercise,
      sets: row.sets,
      repRange: row.repRange,
      inputMode: 'plates',
    };
  }

  return {
    exercise: row.exercise,
    sets: row.sets,
    repRange: row.repRange,
  };
}

export function buildSplitsFromCsv(csvText: string): Split[] {
  const grouped = new Map<string, Exercise[]>();

  for (const row of normalizeRows(csvText)) {
    const exercises = grouped.get(row.day);
    if (exercises) {
      exercises.push(toExercise(row));
    } else {
      grouped.set(row.day, [toExercise(row)]);
    }
  }

  const orderedDays: Record<string, Exercise[]> = {};
  for (const dayName of EXPECTED_DAY_ORDER) {
    const exercises = grouped.get(dayName);
    if (exercises) orderedDays[dayName] = exercises;
  }

  // Include any unexpected day labels at the end, preserving CSV insertion order.
  for (const [dayName, exercises] of grouped.entries()) {
    if (dayName in orderedDays) continue;
    orderedDays[dayName] = exercises;
  }

  return [{ split: 'PPLs', days: orderedDays }];
}
