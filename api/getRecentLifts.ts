import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const SHEET_NAME = 'Recent_Lifts';
const MAX_ROWS = 3;

/** Lift_Log / Recent_Lifts column order: date, time, split, day, exercise, setNumber, weight, reps, rir, notes */
const COL = { date: 0, time: 1, exercise: 4, weight: 6, reps: 7, rir: 8 } as const;

interface RecentLiftRow {
  date: string;
  weight: string | number;
  reps: string | number;
  rir: string | number;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
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
    const dataRows = rows.slice(1);

    const matched: Array<{ date: string; time: string; weight: unknown; reps: unknown; rir: unknown }> = [];
    for (const row of dataRows) {
      const arr = row as unknown[];
      const ex = String(arr[COL.exercise] ?? '').trim();
      if (ex.toLowerCase() !== exerciseName.toLowerCase()) continue;
      const dateStr = String(arr[COL.date] ?? '').trim();
      if (!dateStr) continue;
      const timeStr = String(arr[COL.time] ?? '').trim();
      matched.push({
        date: dateStr,
        time: timeStr,
        weight: arr[COL.weight] ?? '',
        reps: arr[COL.reps] ?? '',
        rir: arr[COL.rir] ?? 0,
      });
    }

    matched.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const top = matched.slice(0, MAX_ROWS);

    const result: RecentLiftRow[] = top.map((r) => ({
      date: r.date,
      weight: r.weight,
      reps: r.reps,
      rir: r.rir,
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getRecentLifts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
