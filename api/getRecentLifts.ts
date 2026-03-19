import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSplitsFromCsv } from '../src/data/parseSplitsCsv';
import { extractPlateMetadata } from '../src/utils/plateNote';
import { normalizeExerciseName, exerciseNamesMatch } from '../src/utils/normalizeExerciseName';

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

async function loadRepRangeByExercise(): Promise<Map<string, RepRange>> {
  const repRangeByExercise = new Map<string, RepRange>();
  const splitsPath = path.join(process.cwd(), 'src', 'data', 'updated Split.csv');
  const csvText = await readFile(splitsPath, 'utf8');
  const splitItems = buildSplitsFromCsv(csvText);

  for (const splitItem of splitItems) {
    for (const dayExercises of Object.values(splitItem.days)) {
      for (const exercise of dayExercises) {
        const exerciseName = normalizeExerciseName(exercise.exercise);
        if (!exerciseName || repRangeByExercise.has(exerciseName)) continue;
        const match = exercise.repRange.match(/(\d+)\s*-\s*(\d+)/);
        if (!match) continue;
        const min = Number(match[1]);
        const max = Number(match[2]);
        if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
        repRangeByExercise.set(exerciseName, { min, max });
      }
    }
  }

  return repRangeByExercise;
}

function parseLiftLogRows(rows: unknown[][]): LiftLogRow[] {
  const dataRows = rows.slice(1);
  return dataRows
    .map((row) => {
      const arr = row as unknown[];
      const dateStr = String(arr[LIFT_LOG_COL.date] ?? '').trim();
      if (!dateStr) return null;
      return {
        date: dateStr,
        time: String(arr[LIFT_LOG_COL.time] ?? '').trim(),
        rawExercise: String(arr[LIFT_LOG_COL.exercise] ?? ''),
        exercise: normalizeExerciseName(arr[LIFT_LOG_COL.exercise]),
        setNumber: Number(arr[LIFT_LOG_COL.setNumber]) || 0,
        weight: arr[LIFT_LOG_COL.weight],
        reps: arr[LIFT_LOG_COL.reps],
        rir: arr[LIFT_LOG_COL.rir],
        notes: arr[LIFT_LOG_COL.notes],
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
