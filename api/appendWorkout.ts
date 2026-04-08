import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type RowRecord = Record<string, unknown>;
type PlateData = { plate45: number; plate35: number; plate25: number; plate10: number; sled: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(value: string): boolean {
  return UUID_RE.test(value);
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parsePlateData(value: unknown): PlateData | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const plate45 = toFiniteNumber(candidate.plate45);
  const plate35 = toFiniteNumber(candidate.plate35);
  const plate25 = toFiniteNumber(candidate.plate25);
  const plate10 = toFiniteNumber(candidate.plate10);
  const sled = toFiniteNumber(candidate.sled);
  if (
    plate45 === null ||
    plate35 === null ||
    plate25 === null ||
    plate10 === null ||
    sled === null
  ) {
    return null;
  }
  return { plate45, plate35, plate25, plate10, sled };
}

function parseAppendBody(body: unknown): { rows: RowRecord[]; workout_id?: string; notes?: string } {
  if (Array.isArray(body)) {
    return { rows: body as RowRecord[] };
  }
  if (body !== null && typeof body === 'object') {
    const o = body as { rows?: unknown; workout_id?: unknown; notes?: unknown };
    if (Array.isArray(o.rows)) {
      const wid = o.workout_id;
      const workout_id =
        typeof wid === 'string' && wid.trim().length > 0 ? wid.trim() : undefined;
      const notesRaw = typeof o.notes === 'string' ? o.notes.trim() : '';
      const notes = notesRaw.length > 0 ? notesRaw : undefined;
      return { rows: o.rows as RowRecord[], workout_id, notes };
    }
  }
  return { rows: [] };
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

/** Ensures API JSON includes message/code for Postgrest and Error instances. */
function errorToJsonDetails(error: unknown): unknown {
  if (error !== null && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if ('message' in o || 'code' in o) {
      return {
        message: o.message,
        code: o.code,
        details: o.details,
        hint: o.hint,
      };
    }
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  console.log('appendWorkout called');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { rows, workout_id: workoutIdFromBody, notes: notesFromBody } = parseAppendBody(req.body);
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'Invalid body: expected non-empty rows' });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sheetName = getSheetName(rows);
    const firstDate = rows[0]?.date;

    try {
      if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      }

      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
      const authHeader = req.headers.authorization ?? '';
      console.log('Authorization header present:', Boolean(authHeader));

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        console.error(new Error('Missing Authorization token'));
        res.status(401).json({ error: 'Missing Authorization token' });
        return;
      }
      const authResult = await supabase.auth.getUser(token);
      if (authResult.error || !authResult.data.user) {
        console.error(authResult.error ?? new Error('Invalid or expired token'));
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      const authenticatedUserId = authResult.data.user.id;
      console.log('user_id:', authResult.data.user.id);

      if (sheetName === 'Lift_Log') {
        const workoutId =
          typeof workoutIdFromBody === 'string' ? workoutIdFromBody.trim() : '';
        if (!workoutId || !isUuidString(workoutId)) {
          res.status(400).json({ error: 'Missing or invalid workout_id' });
          return;
        }

        const { data: workoutOwned, error: workoutCheckError } = await supabase
          .from('workouts')
          .select('id, splits!inner(user_id)')
          .eq('id', workoutId)
          .maybeSingle();

        if (workoutCheckError || !workoutOwned) {
          res.status(400).json({ error: 'Invalid workout_id' });
          return;
        }

        const splitJoin = (workoutOwned as { splits?: { user_id: string } | Array<{ user_id: string }> }).splits;
        const ownerId = Array.isArray(splitJoin) ? splitJoin[0]?.user_id : splitJoin?.user_id;
        if (ownerId !== authenticatedUserId) {
          res.status(400).json({ error: 'Invalid workout_id' });
          return;
        }

        let exerciseIdToUse: string | null = null;
        const exerciseSelect = await supabase
          .from('exercises')
          .select('id')
          .limit(1)
          .maybeSingle();

        if (exerciseSelect.error) {
          console.error(exerciseSelect.error);
          throw exerciseSelect.error;
        }
        if (exerciseSelect.data?.id) {
          exerciseIdToUse = exerciseSelect.data.id;
        } else {
          const exerciseInsert = await supabase
            .from('exercises')
            .insert({ name: 'Test Exercise' })
            .select('id')
            .single();
          if (exerciseInsert.error || !exerciseInsert.data?.id) {
            console.error(exerciseInsert.error ?? new Error('Failed to create fallback exercise'));
            throw exerciseInsert.error ?? new Error('Failed to create fallback exercise');
          }
          exerciseIdToUse = exerciseInsert.data.id;
        }

        const sessionDate = String(firstDate ?? new Date().toISOString());
        console.log('Inserting session:', {
          user_id: authenticatedUserId,
          workout_id: workoutId,
          date: sessionDate,
          notes: notesFromBody,
        });

        const sessionInsert = await supabase
          .from('sessions')
          .insert({
            user_id: authenticatedUserId,
            workout_id: workoutId,
            date: sessionDate,
            notes: notesFromBody,
          })
          .select('id')
          .single();

        if (sessionInsert.error || !sessionInsert.data?.id) {
          console.error(sessionInsert.error ?? new Error('Failed to create lift session in Supabase'));
          throw sessionInsert.error ?? new Error('Failed to create lift session in Supabase');
        }
        console.log('Session insert success:', { session_id: sessionInsert.data.id });

        const sessionId = sessionInsert.data.id;
        const liftSetsPayload = rows.map((r) => {
          const parsedWeight = Number(r.weight);
          const parsedReps = Number(r.reps);
          const parsedRir = Number(r.rir);

          return {
            session_id: sessionId,
            exercise_id: exerciseIdToUse,
            exercise_name: String(r.exercise ?? ''),
            weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
            reps: Number.isFinite(parsedReps) ? parsedReps : 0,
            rir: Number.isFinite(parsedRir) ? parsedRir : 0,
            plate_data: parsePlateData(r.plate_data),
          };
        });

        console.log('Inserting lift sets:', rows.length);
        const liftSetInsert = await supabase.from('lift_sets').insert(liftSetsPayload);
        if (liftSetInsert.error) {
          console.error(liftSetInsert.error);
          throw liftSetInsert.error;
        }
        console.log('Lift sets insert success');
      } else {
        const cardioType =
          sheetName === 'Run_Log' ? 'Run' : sheetName === 'Bike_Log' ? 'Bike' : 'Swim';
        const cardioPayload = rows.map((r) => {
          const parsedDistance = Number(r.distance);
          const parsedDuration = Number(r.timeSeconds);
          return {
            user_id: authenticatedUserId,
            type: cardioType,
            distance: Number.isFinite(parsedDistance) ? parsedDistance : 0,
            duration: Number.isFinite(parsedDuration) ? parsedDuration : 0,
          };
        });
        console.log('Inserting cardio sessions:', cardioPayload.length);
        const cardioInsert = await supabase.from('cardio_sessions').insert(cardioPayload);
        if (cardioInsert.error) {
          console.error(cardioInsert.error);
          throw cardioInsert.error;
        }
        console.log('Cardio sessions insert success');
      }

      console.log('Supabase write success');
      res.status(200).json({ success: true });
      return;
    } catch (error) {
      console.error('SUPABASE WRITE FAILED:', error);
      res.status(500).json({
        error: 'Supabase write failed',
        details: errorToJsonDetails(error),
      });
      return;
    }
  } catch (error) {
    console.error('Error in appendWorkout:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
