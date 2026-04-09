import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type CsvRow = {
  date: string;
  time: string;
  split: string;
  day: string;
  notes: string;
};

type SessionWithWorkout = {
  id: string;
  date: string;
  workouts: { name: string } | Array<{ name: string }> | null;
};

const DEFAULT_CSV_PATH = path.join(
  process.cwd(),
  'src',
  'data',
  'Van Training - Notes import.csv',
);
const TARGET_USER_ID =
  process.env.SESSION_NOTES_USER_ID ?? 'e754e7e9-ff46-4788-a02a-a264db8d396d';
const MATCH_TOLERANCE_MINUTES = 2;
const NEW_YORK_TZ = 'America/New_York';

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

function parseTimeToMinutes(timeRaw: string): number | null {
  const trimmed = timeRaw.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatSessionInNy(iso: string): { date: string; minutes: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '');
  if (!year || !month || !day) return null;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { date: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
}

function toWorkoutName(value: SessionWithWorkout['workouts']): string {
  if (!value) return '';
  if (Array.isArray(value)) return value[0]?.name ?? '';
  return value.name ?? '';
}

function parseCsvRows(csvText: string): CsvRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0] ?? '');
  const dateIdx = findColumnIndex(headers, ['date']);
  const timeIdx = findColumnIndex(headers, ['time']);
  const splitIdx = findColumnIndex(headers, ['split']);
  const dayIdx = findColumnIndex(headers, ['day']);
  let notesIdx = findColumnIndex(headers, ['notes', 'note']);
  if (notesIdx < 0 && headers.length > 0) {
    const lastHeader = normalizeHeader(headers[headers.length - 1] ?? '');
    if (!lastHeader || lastHeader.startsWith('unnamed')) notesIdx = headers.length - 1;
  }

  if (dateIdx < 0 || timeIdx < 0 || dayIdx < 0 || notesIdx < 0) {
    throw new Error('CSV header must include date,time,day,notes');
  }

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const date = String(cols[dateIdx] ?? '').trim();
    const time = String(cols[timeIdx] ?? '').trim();
    const split = splitIdx >= 0 ? String(cols[splitIdx] ?? '').trim() : '';
    const day = String(cols[dayIdx] ?? '').trim();
    const notes = String(cols[notesIdx] ?? '').trim();
    if (!date || !time || !day || !notes) continue;
    rows.push({ date, time, split, day, notes });
  }
  return rows;
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
  const csvRows = parseCsvRows(csvText);
  if (csvRows.length === 0) {
    console.log('No notes rows found.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const sessionsQuery = await supabase
    .from('sessions')
    .select('id,date,workouts!inner(name)')
    .eq('user_id', TARGET_USER_ID);

  if (sessionsQuery.error) throw sessionsQuery.error;
  const sessions = (sessionsQuery.data ?? []) as SessionWithWorkout[];

  const candidates = sessions
    .map((s) => {
      const ny = formatSessionInNy(s.date);
      if (!ny) return null;
      return {
        id: s.id,
        workoutName: toWorkoutName(s.workouts),
        date: ny.date,
        minutes: ny.minutes,
      };
    })
    .filter((s): s is { id: string; workoutName: string; date: string; minutes: number } => s !== null);

  let updated = 0;
  let skipped = 0;

  for (const row of csvRows) {
    const targetMinutes = parseTimeToMinutes(row.time);
    if (targetMinutes === null) {
      skipped += 1;
      continue;
    }

    const matching = candidates
      .filter((s) => s.workoutName === row.day && s.date === row.date)
      .map((s) => ({ ...s, diff: Math.abs(s.minutes - targetMinutes) }))
      .filter((s) => s.diff <= MATCH_TOLERANCE_MINUTES)
      .sort((a, b) => a.diff - b.diff);

    const best = matching[0];
    if (!best) {
      skipped += 1;
      continue;
    }

    const update = await supabase
      .from('sessions')
      .update({ notes: row.notes })
      .eq('id', best.id);
    if (update.error) throw update.error;
    updated += 1;
  }

  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
}

main().catch((error) => {
  console.error('Update notes failed:', error);
  process.exit(1);
});
