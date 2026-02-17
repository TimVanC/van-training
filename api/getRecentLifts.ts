import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const SHEET_NAME = 'Recent_Lifts';

/** Recent_Lifts: one row per exercise. Cols: Exercise, 1_Weight, 1_Reps, 1_RIR, 2_Weight, 2_Reps, 2_RIR, 3_Weight, 3_Reps, 3_RIR */
interface RecentLiftEntry {
  weight: string | number;
  reps: string | number;
  rir: string | number;
}

function isRepsEmpty(reps: unknown): boolean {
  if (reps == null) return true;
  return String(reps).trim() === '';
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
    const range = `${SHEET_NAME}!A:J`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = (resp.data.values ?? []) as unknown[][];
    const row = rows.find((r) => String((r as unknown[])[0] ?? '').trim().toLowerCase() === normalizedExercise) as unknown[] | undefined;

    if (!row) {
      res.status(200).json([]);
      return;
    }

    const entries: RecentLiftEntry[] = [
      { weight: row[1], reps: row[2], rir: row[3] ?? 0 },
      { weight: row[4], reps: row[5], rir: row[6] ?? 0 },
      { weight: row[7], reps: row[8], rir: row[9] ?? 0 },
    ].filter((e) => !isRepsEmpty(e.reps));

    res.status(200).json(entries);
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
