import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const RECENT_LIFTS_SHEET = 'Recent_Lifts';
const LIFT_LOG_SHEET = 'Lift_Log';

/** Recent_Lifts: one row per exercise. Cols: Exercise, 1_Weight, 1_Reps, 1_RIR, ... */
/** Lift_Log: date, time, split, day, exercise, setNumber, weight, reps, rir, volume, notes */
const LIFT_LOG_COL = { date: 0, time: 1, exercise: 4 } as const;

interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
}

function isRepsEmpty(reps: unknown): boolean {
  if (reps == null) return true;
  return String(reps).trim() === '';
}

function getMostRecentDateFromLiftLog(
  rows: unknown[][],
  normalizedExercise: string,
): string | undefined {
  const matched: Array<{ date: string; time: string }> = [];
  for (const row of rows) {
    const arr = row as unknown[];
    const ex = String(arr[LIFT_LOG_COL.exercise] ?? '').trim().toLowerCase();
    if (ex !== normalizedExercise) continue;
    const dateStr = String(arr[LIFT_LOG_COL.date] ?? '').trim();
    if (!dateStr) continue;
    const timeStr = String(arr[LIFT_LOG_COL.time] ?? '').trim();
    matched.push({ date: dateStr, time: timeStr });
  }
  if (matched.length === 0) return undefined;
  matched.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return matched[0]!.date;
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

    const normalizedExercise = exerciseName.toLowerCase();

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

    let trainedOn: string | undefined;
    try {
      const liftLogResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${LIFT_LOG_SHEET}!A:J`,
      });
      const liftLogRows = (liftLogResp.data.values ?? []) as unknown[][];
      const dataRows = liftLogRows.slice(1);
      trainedOn = getMostRecentDateFromLiftLog(dataRows, normalizedExercise);
    } catch {
      // Lift_Log may not exist
    }

    let sets: RecentLiftEntry[] = [];
    try {
      const recentResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${RECENT_LIFTS_SHEET}!A:J`,
      });
      const recentRows = (recentResp.data.values ?? []) as unknown[][];
      const row = recentRows.find((r) => String((r as unknown[])[0] ?? '').trim().toLowerCase() === normalizedExercise) as unknown[] | undefined;
      if (row) {
        sets = [
          { weight: row[1], reps: row[2], rir: row[3] ?? 0 },
          { weight: row[4], reps: row[5], rir: row[6] ?? 0 },
          { weight: row[7], reps: row[8], rir: row[9] ?? 0 },
        ].filter((e) => !isRepsEmpty(e.reps));
      }
    } catch {
      // Recent_Lifts may not exist
    }

    res.status(200).json({ trainedOn, sets });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
