import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type CsvRow = {
  date: string;
  exerciseName: string;
  weight: number;
  reps: number;
  rir: number;
  notes?: string;
};

const TARGET_USER_ID = 'e754e7e9-ff46-4788-a02a-a264db8d396d';
const TEST_WORKOUT_ID = '7e720bf6-c1ff-46d5-a287-7f0e19147eab';
const DEFAULT_CSV_PATH = path.join(
  process.cwd(),
  'src',
  'data',
  'Van Training - User data.csv',
);
const MAX_BATCH = 500;

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
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map((c) => normalizeHeader(c));
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i] ?? '');
    if (normalizedCandidates.includes(h)) return i;
  }
  return -1;
}

function toPositiveFiniteNumber(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toDateIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; details?: unknown };
  const message = String(e.message ?? '');
  const details = String(e.details ?? '');
  return message.includes(columnName) || details.includes(columnName);
}

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? DEFAULT_CSV_PATH;
  const csvPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  console.log(`Reading CSV: ${csvPath}`);
  const csvText = await readFile(csvPath, 'utf8');
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length <= 1) {
    console.log('No data rows found in CSV.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const exerciseLookup = await supabase
    .from('exercises')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (exerciseLookup.error) {
    throw exerciseLookup.error;
  }

  let exerciseId = exerciseLookup.data?.id ?? null;
  if (!exerciseId) {
    const inserted = await supabase
      .from('exercises')
      .insert({ name: 'Test Exercise' })
      .select('id')
      .single();
    if (inserted.error || !inserted.data?.id) {
      throw inserted.error ?? new Error('Failed to create fallback exercise');
    }
    exerciseId = inserted.data.id;
  }

  const parsedRows: CsvRow[] = [];
  let skipped = 0;
  const headerCols = parseCsvLine(lines[0] ?? '');
  const dateIdx = findColumnIndex(headerCols, ['date']);
  const exerciseIdx = findColumnIndex(headerCols, ['exercise', 'exercise name']);
  const weightIdx = findColumnIndex(headerCols, ['weight']);
  const repsIdx = findColumnIndex(headerCols, ['reps']);
  const rirIdx = findColumnIndex(headerCols, ['rir']);
  let notesIdx = findColumnIndex(headerCols, ['notes', 'note']);
  if (notesIdx < 0 && headerCols.length > 0) {
    const lastHeader = normalizeHeader(headerCols[headerCols.length - 1] ?? '');
    if (!lastHeader || lastHeader.startsWith('unnamed')) {
      notesIdx = headerCols.length - 1;
    }
  }
  if (dateIdx < 0 || exerciseIdx < 0 || weightIdx < 0 || repsIdx < 0 || rirIdx < 0) {
    throw new Error('CSV header is missing one or more required columns (date, exercise, weight, reps, rir).');
  }

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const dateRaw = String(cols[dateIdx] ?? '').trim();
    const exerciseName = String(cols[exerciseIdx] ?? '').trim();
    const weightRaw = String(cols[weightIdx] ?? '').trim();
    const repsRaw = String(cols[repsIdx] ?? '').trim();
    const rirRaw = String(cols[rirIdx] ?? '').trim();
    const notesRaw = notesIdx >= 0 ? String(cols[notesIdx] ?? '').trim() : '';

    const date = toDateIso(dateRaw);
    const weight = toPositiveFiniteNumber(weightRaw);
    const reps = toPositiveFiniteNumber(repsRaw);
    const rirParsed = toPositiveFiniteNumber(rirRaw);

    // Skip empty/invalid rows (negative weight is valid for assisted bodyweight movements).
    if (!date || !exerciseName || weight === null || reps === null || reps <= 0) {
      skipped += 1;
      continue;
    }

    parsedRows.push({
      date,
      exerciseName,
      weight,
      reps,
      rir: rirParsed !== null && rirParsed >= 0 ? rirParsed : 0,
      ...(notesRaw ? { notes: notesRaw } : {}),
    });
  }

  if (parsedRows.length === 0) {
    console.log(`No valid rows to import. Skipped ${skipped}.`);
    return;
  }

  const uniqueDates = Array.from(new Set(parsedRows.map((r) => r.date))).sort((a, b) =>
    a.localeCompare(b),
  );
  const dateToSessionNote = new Map<string, string>();
  for (const row of parsedRows) {
    if (!row.notes) continue;
    const existing = dateToSessionNote.get(row.date);
    if (!existing) {
      dateToSessionNote.set(row.date, row.notes);
    }
  }

  const dateToSessionId = new Map<string, string>();
  for (const date of uniqueDates) {
    const note = dateToSessionNote.get(date);
    let inserted = await supabase
      .from('sessions')
      .insert({
        user_id: TARGET_USER_ID,
        workout_id: TEST_WORKOUT_ID,
        date,
        ...(note ? { notes: note } : {}),
      })
      .select('id')
      .single();
    if (inserted.error && isMissingColumnError(inserted.error, 'notes')) {
      inserted = await supabase
        .from('sessions')
        .insert({
          user_id: TARGET_USER_ID,
          workout_id: TEST_WORKOUT_ID,
          date,
        })
        .select('id')
        .single();
    }

    if (inserted.error || !inserted.data?.id) {
      throw inserted.error ?? new Error(`Failed to insert session for date ${date}`);
    }
    dateToSessionId.set(date, inserted.data.id);
  }

  const liftSetPayload = parsedRows.flatMap((row) => {
    const sessionId = dateToSessionId.get(row.date);
    if (!sessionId) return [];
    return [
      {
        session_id: sessionId,
        exercise_id: exerciseId,
        exercise_name: row.exerciseName,
        weight: row.weight,
        reps: row.reps,
        rir: row.rir,
      },
    ];
  });

  for (const batch of chunk(liftSetPayload, MAX_BATCH)) {
    const insert = await supabase.from('lift_sets').insert(batch);
    if (insert.error) {
      throw insert.error;
    }
  }

  console.log(
    `Import complete. Sessions: ${uniqueDates.length}, lift_sets: ${liftSetPayload.length}, skipped: ${skipped}`,
  );
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
