import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1hWmeYoGpiw58XilR8-KgIysuq11qI7TE2CTg3WIyuN0';

type RowRecord = Record<string, unknown>;

function getSheetName(rows: RowRecord[]): string {
  const first = rows[0];
  if (!first) return 'Lift_Log';
  if ('split' in first) return 'Lift_Log';
  if ('pacePerMile' in first) return 'Run_Log';
  if ('avgSpeed' in first) return 'Bike_Log';
  if ('pacePer100' in first) return 'Swim_Log';
  return 'Lift_Log';
}

function toLiftRow(r: RowRecord): unknown[] {
  return [
    r.date ?? '',
    r.split ?? '',
    r.day ?? '',
    r.exercise ?? '',
    r.setNumber ?? '',
    r.weight ?? '',
    r.reps ?? '',
    r.rir ?? '',
    r.notes ?? '',
  ];
}

function toRunRow(r: RowRecord): unknown[] {
  return [
    r.date ?? '',
    r.distance ?? '',
    r.timeSeconds ?? '',
    r.pacePerMile ?? '',
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function toBikeRow(r: RowRecord): unknown[] {
  return [
    r.date ?? '',
    r.distance ?? '',
    r.timeSeconds ?? '',
    r.avgSpeed ?? '',
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function toSwimRow(r: RowRecord): unknown[] {
  return [
    r.date ?? '',
    r.distance ?? '',
    r.timeSeconds ?? '',
    r.pacePer100 ?? '',
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function formatRows(rows: RowRecord[], sheetName: string): unknown[][] {
  if (sheetName === 'Lift_Log') return rows.map(toLiftRow);
  if (sheetName === 'Run_Log') return rows.map(toRunRow);
  if (sheetName === 'Bike_Log') return rows.map(toBikeRow);
  if (sheetName === 'Swim_Log') return rows.map(toSwimRow);
  return rows.map(toLiftRow);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rows = req.body as RowRecord[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'Invalid body: expected non-empty array' });
      return;
    }

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
      console.error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets'],
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = getSheetName(rows);
    const formattedRows = formatRows(rows, sheetName);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: formattedRows },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in appendWorkout:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
