import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const LIFT_LOG_SHEET = 'Lift_Log';

/** Lift_Log: date, time, split, day, exercise, setNumber, weight, reps, rir, volume, notes */
const LIFT_LOG_COL = { date: 0, time: 1, exercise: 4, setNumber: 5, weight: 6, reps: 7, rir: 8, notes: 10 } as const;

interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
}

interface LiftLogRow {
  date: string;
  time: string;
  exercise: string;
  setNumber: number;
  weight: unknown;
  reps: unknown;
  rir: unknown;
  notes: unknown;
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
        exercise: String(arr[LIFT_LOG_COL.exercise] ?? '').trim().toLowerCase(),
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

    let lastTrained: string | undefined;
    let sets: RecentLiftEntry[] = [];
    let previousNote: string | undefined;

    try {
      const liftLogResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${LIFT_LOG_SHEET}!A:K`,
      });
      const rawRows = (liftLogResp.data.values ?? []) as unknown[][];
      const parsed = parseLiftLogRows(rawRows);
      const matched = parsed.filter((r) => r.exercise === normalizedExercise);
      matched.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

      if (matched.length > 0) {
        const first = matched[0]!;
        lastTrained = first.date;

        const mostRecentSessionRows = matched.filter(
          (r) => r.date === first.date && r.time === first.time,
        );
        const lastSetOfSession = mostRecentSessionRows.reduce(
          (acc, r) => (r.setNumber > acc.setNumber ? r : acc),
          mostRecentSessionRows[0]!,
        );
        const noteVal = lastSetOfSession?.notes;
        if (noteVal != null && String(noteVal).trim() !== '') {
          previousNote = String(noteVal).trim();
        }

        sets = matched.slice(0, targetSets).map((r) => ({
          weight: r.weight ?? '',
          reps: r.reps ?? '',
          rir: r.rir ?? 0,
        }));
      }
    } catch {
      // Lift_Log may not exist
    }

    res.status(200).json({ lastTrained, sets, previousNote });
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
