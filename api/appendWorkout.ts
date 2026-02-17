import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';

type RowRecord = Record<string, unknown>;

const EXERCISE_MAP_SHEET = 'Exercise_Map';
/** Exercise_Map columns: A = exercise name, B = equipment_type */

/** All exercises from splits.json with inferred equipment_type */
const SEED_EXERCISES: Array<{ exercise: string; equipment_type: string }> = [
  { exercise: 'Incline Dumbbell Press', equipment_type: 'dumbbell' },
  { exercise: 'Flat Machine Chest Press', equipment_type: 'machine' },
  { exercise: 'Weighted Chest Dips', equipment_type: 'bodyweight' },
  { exercise: 'Overhead Cable Triceps Extension', equipment_type: 'machine' },
  { exercise: 'Pronated Triceps Pushdowns', equipment_type: 'machine' },
  { exercise: 'Neutral Grip Pull-Ups', equipment_type: 'bodyweight' },
  { exercise: 'Single Arm Cable Lat Pulldown', equipment_type: 'machine' },
  { exercise: 'Seated Cable Row', equipment_type: 'machine' },
  { exercise: 'Straight Arm Pulldown', equipment_type: 'machine' },
  { exercise: 'Incline Dumbbell Curl', equipment_type: 'dumbbell' },
  { exercise: 'Leg Press', equipment_type: 'machine' },
  { exercise: 'Romanian Deadlift', equipment_type: 'machine' },
  { exercise: 'Leg Extension', equipment_type: 'machine' },
  { exercise: 'Hamstring Curl', equipment_type: 'machine' },
  { exercise: 'Standing Calf Raise', equipment_type: 'machine' },
  { exercise: 'Seated Dumbbell Shoulder Press', equipment_type: 'dumbbell' },
  { exercise: 'Cable Lateral Raises', equipment_type: 'machine' },
  { exercise: 'Cable Rear Delt Fly', equipment_type: 'machine' },
  { exercise: 'Flat Dumbbell Press', equipment_type: 'dumbbell' },
  { exercise: 'High to Low Cable Fly', equipment_type: 'machine' },
  { exercise: 'Low to High Cable Fly', equipment_type: 'machine' },
  { exercise: 'Slight Decline Machine Press', equipment_type: 'machine' },
  { exercise: 'Reverse Grip Cable Pressdowns', equipment_type: 'machine' },
  { exercise: 'Heavy Seated Cable Row', equipment_type: 'machine' },
  { exercise: 'Incline Bench Dumbbell Row', equipment_type: 'dumbbell' },
  { exercise: 'Preacher Curls', equipment_type: 'machine' },
  { exercise: 'Hammer Curls', equipment_type: 'machine' },
  { exercise: 'Seated or Standing Calf Raise', equipment_type: 'machine' },
];

function inferEquipment(exercise: string): string {
  const lower = exercise.toLowerCase();
  if (lower.includes('dumbbell')) return 'dumbbell';
  if (/pull-up|pull up|chest dips|weighted.*dips/i.test(exercise)) return 'bodyweight';
  return 'machine';
}

async function sheetExists(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<boolean> {
  const resp = await sheets.spreadsheets.get({ spreadsheetId });
  return (resp.data.sheets ?? []).some(
    (s) => (s.properties?.title ?? '').toLowerCase() === title.toLowerCase(),
  );
}

async function createAndSeedExerciseMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: EXERCISE_MAP_SHEET },
          },
        },
      ],
    },
  });

  const headerAndRows: string[][] = [
    ['exercise', 'equipment_type'],
    ...SEED_EXERCISES.map((e) => [e.exercise, e.equipment_type]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${EXERCISE_MAP_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: headerAndRows },
  });
}

async function getExerciseEquipmentMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${EXERCISE_MAP_SHEET}!A:B`,
    });
    const rows = (resp.data.values ?? []) as string[][];
    const start = rows.length > 0 && /^(exercise|equipment)/i.test(String(rows[0][0] ?? '')) ? 1 : 0;
    for (let i = start; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const ex = String(row[0] ?? '').trim();
      const eq = String(row[1] ?? '').trim();
      if (ex) map.set(ex.toLowerCase(), eq || 'machine');
    }
  } catch {
    // Sheet may not exist
  }
  return map;
}

async function ensureExerciseMapAndGetMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Map<string, string>> {
  const exists = await sheetExists(sheets, spreadsheetId, EXERCISE_MAP_SHEET);
  if (!exists) {
    await createAndSeedExerciseMap(sheets, spreadsheetId);
  }
  return getExerciseEquipmentMap(sheets, spreadsheetId);
}

async function appendExerciseToMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  exercise: string,
  equipmentType: string,
): Promise<void> {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${EXERCISE_MAP_SHEET}!A:B`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[exercise, equipmentType]] },
    });
  } catch (e) {
    console.error('Failed to append exercise to Exercise_Map:', e);
  }
}

function formatDateAndTime(iso: unknown): { date: string; time: string } {
  const str = typeof iso === 'string' ? iso : '';
  const dateObj = new Date(str);
  if (isNaN(dateObj.getTime())) return { date: '', time: '' };
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(dateObj);
  const date = `${parts.find((p) => p.type === 'year')?.value ?? ''}-${parts.find((p) => p.type === 'month')?.value ?? ''}-${parts.find((p) => p.type === 'day')?.value ?? ''}`;
  const time = `${parts.find((p) => p.type === 'hour')?.value ?? ''}:${parts.find((p) => p.type === 'minute')?.value ?? ''}`;
  return { date, time };
}

function getSheetName(rows: RowRecord[]): string {
  const first = rows[0];
  if (!first) return 'Lift_Log';
  if ('split' in first) return 'Lift_Log';
  if ('pacePerMile' in first) return 'Run_Log';
  if ('avgSpeed' in first) return 'Bike_Log';
  if ('pacePer100' in first) return 'Swim_Log';
  return 'Lift_Log';
}

function toLiftRow(r: RowRecord, equipmentMap: Map<string, string>): unknown[] {
  const { date, time } = formatDateAndTime(r.date);
  const normalizedWeight = Number(r.weight);
  const normalizedReps = Number(r.reps);
  const w = Number.isFinite(normalizedWeight) ? normalizedWeight : 0;
  const rp = Number.isFinite(normalizedReps) ? normalizedReps : 0;
  const equipment = equipmentMap.get(String(r.exercise ?? '').trim().toLowerCase()) ?? '';
  const volume = w === 0 ? 0 : equipment === 'dumbbell' ? w * 2 * rp : w * rp;

  return [
    date,
    time,
    r.split ?? '',
    r.day ?? '',
    r.exercise ?? '',
    r.setNumber ?? '',
    r.weight ?? '',
    r.reps ?? '',
    r.rir ?? '',
    volume,
    r.notes ?? '',
  ];
}

function toRunRow(r: RowRecord): unknown[] {
  const { date, time } = formatDateAndTime(r.date);
  const timeSeconds = Number(r.timeSeconds) || 0;
  const timeMinutes = Number((timeSeconds / 60).toFixed(2));
  const pacePerMile = Number(r.pacePerMile) || 0;
  const paceMinutesPerMile = Number((pacePerMile / 60).toFixed(2));
  return [
    date,
    time,
    r.distance ?? '',
    timeMinutes,
    paceMinutesPerMile,
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function toBikeRow(r: RowRecord): unknown[] {
  const { date, time } = formatDateAndTime(r.date);
  const timeSeconds = Number(r.timeSeconds) || 0;
  const timeMinutes = Number((timeSeconds / 60).toFixed(2));
  return [
    date,
    time,
    r.distance ?? '',
    timeMinutes,
    r.avgSpeed ?? '',
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function toSwimRow(r: RowRecord): unknown[] {
  const { date, time } = formatDateAndTime(r.date);
  const timeSeconds = Number(r.timeSeconds) || 0;
  const timeMinutes = Number((timeSeconds / 60).toFixed(2));
  const pacePer100 = Number(r.pacePer100) || 0;
  const paceMinutesPer100 = Number((pacePer100 / 60).toFixed(2));
  return [
    date,
    time,
    r.distance ?? '',
    timeMinutes,
    paceMinutesPer100,
    r.rpe ?? '',
    r.notes ?? '',
  ];
}

function formatRows(rows: RowRecord[], sheetName: string, equipmentMap: Map<string, string>): unknown[][] {
  if (sheetName === 'Lift_Log') return rows.map((r) => toLiftRow(r, equipmentMap));
  if (sheetName === 'Run_Log') return rows.map(toRunRow);
  if (sheetName === 'Bike_Log') return rows.map(toBikeRow);
  if (sheetName === 'Swim_Log') return rows.map(toSwimRow);
  return rows.map((r) => toLiftRow(r, equipmentMap));
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

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error('Missing GOOGLE_SHEET_ID environment variable');
    }

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
      console.error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
      res.status(500).json({ error: 'Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY' });
      return;
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = getSheetName(rows);
    const equipmentMap = await ensureExerciseMapAndGetMap(sheets, spreadsheetId);

    if (sheetName === 'Lift_Log') {
      const seen = new Set<string>();
      for (const r of rows) {
        const ex = String(r.exercise ?? '').trim();
        if (!ex || seen.has(ex.toLowerCase())) continue;
        seen.add(ex.toLowerCase());
        if (!equipmentMap.has(ex.toLowerCase())) {
          const equipmentType = inferEquipment(ex);
          equipmentMap.set(ex.toLowerCase(), equipmentType);
          await appendExerciseToMap(sheets, spreadsheetId, ex, equipmentType);
        }
      }
    }

    const formattedRows = formatRows(rows, sheetName, equipmentMap);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
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
