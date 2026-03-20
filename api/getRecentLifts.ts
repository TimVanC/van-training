import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LIFT_LOG_SHEET = 'Lift_Log';

/** Lift_Log: date, time, split, day, exercise, setNumber, weight, reps, rir, volume, notes */
const LIFT_LOG_COL = { date: 0, time: 1, exercise: 4, setNumber: 5, weight: 6, reps: 7, rir: 8, notes: 10 } as const;

interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
  plateBreakdown?: {
    plate45: number;
    plate35: number;
    plate25: number;
    plate10: number;
    sled: number;
  };
}

interface LiftLogRow {
  date: string;
  time: string;
  exercise: string;
  rawExercise: string;
  setNumber: number;
  weight: unknown;
  reps: unknown;
  rir: unknown;
  notes: unknown;
}

interface RepRange {
  min: number;
  max: number;
}

interface RecommendedPlanSet {
  setNumber: number;
  weight: number;
  targetReps: number;
  targetRIR: number;
}

interface SessionHistory {
  date: string;
  time: string;
  rows: LiftLogRow[];
}

interface ProgressionMetrics {
  lastTopSetWeight?: number;
  lastTopSetReps?: number;
  estimatedOneRepMax?: number;
  totalReps?: number;
}

const ZERO_WIDTH_OR_BOM = /[\u200B-\u200D\uFEFF]/g;
const PLATE_NOTE_REGEX = /^\[plate_meta p45=(-?\d+(?:\.\d+)?);p35=(-?\d+(?:\.\d+)?);p25=(-?\d+(?:\.\d+)?);p10=(-?\d+(?:\.\d+)?);sled=(-?\d+(?:\.\d+)?)\]\s*/;

function normalizeExerciseName(name: unknown): string {
  return String(name ?? '')
    .replace(ZERO_WIDTH_OR_BOM, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canonicalExerciseToken(name: unknown): string {
  return normalizeExerciseName(name).replace(/[^a-z0-9]/g, '');
}

function tokenizeExerciseName(name: unknown): string[] {
  return normalizeExerciseName(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token));
}

function exerciseNamesMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeExerciseName(left);
  const normalizedRight = normalizeExerciseName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const canonicalLeft = canonicalExerciseToken(normalizedLeft);
  const canonicalRight = canonicalExerciseToken(normalizedRight);
  if (!canonicalLeft || !canonicalRight) return false;
  if (canonicalLeft === canonicalRight) return true;
  if (canonicalLeft.endsWith('s') && canonicalLeft.slice(0, -1) === canonicalRight) return true;
  if (canonicalRight.endsWith('s') && canonicalRight.slice(0, -1) === canonicalLeft) return true;
  if (canonicalLeft.includes(canonicalRight) && (canonicalLeft.length - canonicalRight.length) <= 6) return true;
  if (canonicalRight.includes(canonicalLeft) && (canonicalRight.length - canonicalLeft.length) <= 6) return true;

  const leftTokens = new Set(tokenizeExerciseName(left));
  const rightTokens = new Set(tokenizeExerciseName(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const minTokenCount = Math.min(leftTokens.size, rightTokens.size);
  return overlap >= 2 && overlap / minTokenCount >= 0.75;
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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

function extractPlateMetadata(noteValue: unknown): {
  plateBreakdown?: {
    plate45: number;
    plate35: number;
    plate25: number;
    plate10: number;
    sled: number;
  };
  cleanedNote: string;
} {
  const note = String(noteValue ?? '').trim();
  if (!note) return { cleanedNote: '' };
  const match = note.match(PLATE_NOTE_REGEX);
  if (!match) return { cleanedNote: note };

  const plate45 = Number(match[1]);
  const plate35 = Number(match[2]);
  const plate25 = Number(match[3]);
  const plate10 = Number(match[4]);
  const sled = Number(match[5]);
  const cleanedNote = note.replace(PLATE_NOTE_REGEX, '').trim();
  if (![plate45, plate35, plate25, plate10, sled].every(Number.isFinite)) {
    return { cleanedNote: note };
  }
  return {
    plateBreakdown: {
      plate45: Math.max(0, Math.trunc(plate45)),
      plate35: Math.max(0, Math.trunc(plate35)),
      plate25: Math.max(0, Math.trunc(plate25)),
      plate10: Math.max(0, Math.trunc(plate10)),
      sled: Math.max(0, sled),
    },
    cleanedNote,
  };
}

function getSessionKey(row: LiftLogRow): string {
  return `${row.date}||${row.time}`;
}

function roundToIncrement(value: number, increment = 5): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / increment) * increment);
}

function computeEstimatedOneRepMax(weight: number, reps: number): number | undefined {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps <= 0) return undefined;
  const oneRm = weight * (1 + reps / 30);
  return Number(oneRm.toFixed(1));
}

function targetForSet(topSetTarget: number, setNumber: number): number {
  if (setNumber === 2) return Math.max(1, topSetTarget - 1);
  return topSetTarget;
}

function weightForSet(topSetWeight: number, setNumber: number): number {
  if (setNumber <= 2) return roundToIncrement(topSetWeight);
  if (setNumber === 3) return roundToIncrement(topSetWeight * 0.9);
  return roundToIncrement(topSetWeight * 0.85);
}

function buildSetTargets(topSetTarget: number, targetSets: number): number[] {
  return Array.from({ length: targetSets }, (_, i) => targetForSet(topSetTarget, i + 1));
}

function buildSessionHistories(rows: LiftLogRow[]): SessionHistory[] {
  const sessions = new Map<string, SessionHistory>();
  for (const row of rows) {
    const key = getSessionKey(row);
    const existing = sessions.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    sessions.set(key, { date: row.date, time: row.time, rows: [row] });
  }

  const ordered = Array.from(sessions.values());
  for (const session of ordered) {
    session.rows.sort((a, b) => a.setNumber - b.setNumber);
  }
  ordered.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return ordered;
}

function parseNumeric(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

interface LiftLogColumnMap {
  date: number;
  time: number;
  exercise: number;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number;
  notes: number;
}

function normalizeHeaderKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectLiftLogColumns(headerRow: unknown[] | undefined): LiftLogColumnMap {
  const defaults: LiftLogColumnMap = { ...LIFT_LOG_COL };
  if (!Array.isArray(headerRow) || headerRow.length === 0) return defaults;

  const normalizedHeaders = headerRow.map((cell) => normalizeHeaderKey(cell));
  const looksLikeHeader = normalizedHeaders.includes('date') && normalizedHeaders.includes('exercise');
  if (!looksLikeHeader) return defaults;

  const findFirst = (keys: string[], fallback: number): number => {
    for (const key of keys) {
      const idx = normalizedHeaders.indexOf(key);
      if (idx >= 0) return idx;
    }
    return fallback;
  };

  return {
    date: findFirst(['date'], defaults.date),
    time: findFirst(['time'], defaults.time),
    exercise: findFirst(['exercise', 'exercisename'], defaults.exercise),
    setNumber: findFirst(['setnumber', 'set'], defaults.setNumber),
    weight: findFirst(['weight'], defaults.weight),
    reps: findFirst(['reps', 'rep'], defaults.reps),
    rir: findFirst(['rir'], defaults.rir),
    notes: findFirst(['notes', 'note'], defaults.notes),
  };
}

async function loadRepRangeByExercise(): Promise<Map<string, RepRange>> {
  const repRangeByExercise = new Map<string, RepRange>();
  const splitsPath = path.join(process.cwd(), 'src', 'data', 'updated Split.csv');
  const csvText = await readFile(splitsPath, 'utf8');
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines.slice(1)) {
    const cols = parseCsvRow(line);
    const exerciseName = normalizeExerciseName(cols[1] ?? '');
    const repRange = String(cols[3] ?? '').trim();
    if (!exerciseName || !repRange || repRangeByExercise.has(exerciseName)) continue;
    const match = repRange.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) continue;
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    repRangeByExercise.set(exerciseName, { min, max });
  }

  return repRangeByExercise;
}

function parseLiftLogRows(rows: unknown[][]): LiftLogRow[] {
  const columns = detectLiftLogColumns(rows[0]);
  const hasHeader = Array.isArray(rows[0]) && normalizeHeaderKey(rows[0][columns.exercise]) === 'exercise';
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((row) => {
      const arr = row as unknown[];
      const dateStr = String(arr[columns.date] ?? '').trim();
      if (!dateStr) return null;
      return {
        date: dateStr,
        time: String(arr[columns.time] ?? '').trim(),
        rawExercise: String(arr[columns.exercise] ?? ''),
        exercise: normalizeExerciseName(arr[columns.exercise]),
        setNumber: Number(arr[columns.setNumber]) || 0,
        weight: arr[columns.weight],
        reps: arr[columns.reps],
        rir: arr[columns.rir],
        notes: arr[columns.notes],
      };
    })
    .filter((r): r is LiftLogRow => r !== null);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const exerciseName = typeof req.query.exercise === 'string' ? req.query.exercise.trim() : '';
    if (!exerciseName) {
      res.status(400).json({ error: 'Missing exercise query parameter' });
      return;
    }

    const rawTarget = req.query.targetSets;
    const targetSets = typeof rawTarget === 'string' ? Math.max(1, parseInt(rawTarget, 10) || 3) : 3;
    const normalizedExercise = normalizeExerciseName(exerciseName);

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error('Missing GOOGLE_SHEET_ID environment variable');
    }

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
      res.status(500).json({ error: 'Missing Google Sheets credentials' });
      return;
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    let lastTrained: string | undefined;
    let sets: RecentLiftEntry[] = [];
    let previousNote: string | undefined;
    let recommendedPlan: RecommendedPlanSet[] | null = null;
    let progressionMetrics: ProgressionMetrics | undefined;
    let repRangeByExercise = new Map<string, RepRange>();

    try {
      repRangeByExercise = await loadRepRangeByExercise();
    } catch {
      // If rep ranges cannot be loaded, fallback still returns recent lift data.
    }

    try {
      const liftLogResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${LIFT_LOG_SHEET}!A:K`,
      });
      const rawRows = (liftLogResp.data.values ?? []) as unknown[][];
      const parsed = parseLiftLogRows(rawRows);
      let matched = parsed.filter((r) => r.exercise === normalizedExercise);
      let usedFallbackMatching = false;
      if (matched.length === 0) {
        matched = parsed.filter((r) => exerciseNamesMatch(r.rawExercise, exerciseName));
        usedFallbackMatching = matched.length > 0;
      }
      matched.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
      const sessions = buildSessionHistories(matched);

      if ((sessions.length === 0 || usedFallbackMatching) && parsed.length > 0) {
        const similarCandidates = parsed
          .filter((row) => row.rawExercise && row.rawExercise.trim() !== '')
          .filter((row) => exerciseNamesMatch(row.rawExercise, exerciseName))
          .slice(0, 10)
          .map((row) => ({
            saved: row.rawExercise,
            normalizedSaved: row.exercise,
          }));
        const candidateRows = parsed
          .filter((row) => row.rawExercise && row.rawExercise.trim() !== '')
          .slice(0, 5)
          .map((row) => ({
            saved: row.rawExercise,
            normalizedSaved: row.exercise,
          }));
        console.log({
          current: exerciseName,
          normalizedCurrent: normalizedExercise,
          fallbackUsed: usedFallbackMatching,
          matchedRows: matched.length,
          similarCandidates,
          candidates: candidateRows,
        });
      }

      if (sessions.length > 0) {
        const mostRecentSession = sessions[0]!;
        lastTrained = mostRecentSession.date;
        const mostRecentSessionRows = mostRecentSession.rows;
        const lastSetOfSession = mostRecentSessionRows.reduce(
          (acc, r) => (r.setNumber > acc.setNumber ? r : acc),
          mostRecentSessionRows[0]!,
        );
        const noteVal = lastSetOfSession?.notes;
        const parsedLastSetNote = extractPlateMetadata(noteVal);
        if (parsedLastSetNote.cleanedNote !== '') {
          previousNote = parsedLastSetNote.cleanedNote;
        }

        sets = mostRecentSessionRows.slice(0, targetSets).map((r) => {
          const parsedNote = extractPlateMetadata(r.notes);
          return {
            weight: r.weight ?? '',
            reps: r.reps ?? '',
            rir: r.rir ?? 0,
            ...(parsedNote.plateBreakdown ? { plateBreakdown: parsedNote.plateBreakdown } : {}),
          };
        });

        const topSetWeight = parseNumeric(mostRecentSessionRows[0]?.weight);
        const topSetReps = parseNumeric(mostRecentSessionRows[0]?.reps);
        const totalReps = mostRecentSessionRows
          .slice(0, targetSets)
          .reduce((sum, row) => sum + (parseNumeric(row.reps) ?? 0), 0);
        progressionMetrics = {
          ...(topSetWeight != null ? { lastTopSetWeight: topSetWeight } : {}),
          ...(topSetReps != null ? { lastTopSetReps: topSetReps } : {}),
          ...(topSetWeight != null && topSetReps != null
            ? { estimatedOneRepMax: computeEstimatedOneRepMax(topSetWeight, topSetReps) }
            : {}),
          totalReps,
        };

        const repRange = repRangeByExercise.get(normalizedExercise);
        if (repRange) {
          const baseTarget = repRange.min;
          const capTarget = repRange.max;
          const chronological = [...sessions].reverse();
          let nextTopTarget = baseTarget;
          let consecutiveAllSetsHit = 0;
          let nextTopWeight = parseNumeric(chronological[0]?.rows[0]?.weight) ?? 0;

          for (const session of chronological) {
            const sessionRows = session.rows.slice(0, targetSets);
            const sessionSetTargets = buildSetTargets(nextTopTarget, targetSets);
            const hasEnoughSets = sessionRows.length >= targetSets;
            const allSetsHitTarget = hasEnoughSets && sessionSetTargets.every((target, idx) => {
              const reps = parseNumeric(sessionRows[idx]?.reps);
              return reps != null && reps >= target;
            });

            if (allSetsHitTarget) consecutiveAllSetsHit += 1;
            else consecutiveAllSetsHit = 0;

            const performedTopReps = parseNumeric(sessionRows[0]?.reps);
            if (performedTopReps != null && performedTopReps >= nextTopTarget) {
              nextTopTarget = Math.min(capTarget, nextTopTarget + 1);
            }

            const performedTopWeight = parseNumeric(sessionRows[0]?.weight);
            if (performedTopWeight != null) {
              nextTopWeight = roundToIncrement(performedTopWeight);
            }

            if (nextTopTarget >= capTarget && consecutiveAllSetsHit >= 2) {
              nextTopWeight = roundToIncrement(nextTopWeight + 5);
              nextTopTarget = baseTarget;
              consecutiveAllSetsHit = 0;
            }
          }

          const plannedSets: RecommendedPlanSet[] = buildSetTargets(nextTopTarget, targetSets)
            .map((targetReps, idx) => ({
              setNumber: idx + 1,
              weight: weightForSet(nextTopWeight, idx + 1),
              targetReps,
              targetRIR: 1,
            }));
          recommendedPlan = plannedSets.length > 0 ? plannedSets : null;
        }
      }
    } catch {
      // Lift_Log may not exist
    }

    res.status(200).json({ lastTrained, sets, previousNote, recommendedPlan, progressionMetrics });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
