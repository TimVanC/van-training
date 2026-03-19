import type { ActiveSession, LiftSession, EnduranceSession } from '../types/session';
import type { LiftRow, RunRow, BikeRow, SwimRow, SessionRow } from '../types/rows';
import { formatPlateMetadata } from './plateNote';

function normalizeLift(session: LiftSession): LiftRow[] {
  const date = session.startedAt;
  const rows: LiftRow[] = [];

  for (const exercise of session.exercises) {
    for (let i = 0; i < exercise.sets.length; i++) {
      const set = exercise.sets[i];
      const row: LiftRow = {
        date,
        split: session.split,
        day: session.day,
        exercise: exercise.activeName ?? exercise.name,
        setNumber: i + 1,
        weight: set.weight,
        reps: set.reps,
        rir: set.rir,
      };
      const isPlatesMode = exercise.inputMode === 'plates';
      const hasPlateMetadata = isPlatesMode
        && Number.isFinite(set.plate45)
        && Number.isFinite(set.plate35)
        && Number.isFinite(set.plate25)
        && Number.isFinite(set.plate10)
        && Number.isFinite(set.sled);
      const sessionNote = session.notes?.trim() ?? '';

      if (hasPlateMetadata) {
        const metadata = formatPlateMetadata({
          plate45: set.plate45 as number,
          plate35: set.plate35 as number,
          plate25: set.plate25 as number,
          plate10: set.plate10 as number,
          sled: set.sled as number,
        });
        row.notes = sessionNote ? `${metadata} ${sessionNote}` : metadata;
      } else if (sessionNote) {
        row.notes = sessionNote;
      }
      rows.push(row);
    }
  }

  return rows;
}

function normalizeRun(session: EnduranceSession): RunRow[] {
  const row: RunRow = {
    date: session.startedAt,
    distance: session.distance,
    timeSeconds: session.totalSeconds,
    pacePerMile: session.derivedMetric,
    rpe: session.rpe,
  };
  if (session.notes) {
    row.notes = session.notes;
  }
  return [row];
}

function normalizeBike(session: EnduranceSession): BikeRow[] {
  const row: BikeRow = {
    date: session.startedAt,
    distance: session.distance,
    timeSeconds: session.totalSeconds,
    avgSpeed: session.derivedMetric,
    rpe: session.rpe,
  };
  if (session.notes) {
    row.notes = session.notes;
  }
  return [row];
}

function normalizeSwim(session: EnduranceSession): SwimRow[] {
  const row: SwimRow = {
    date: session.startedAt,
    distance: session.distance,
    timeSeconds: session.totalSeconds,
    pacePer100: session.derivedMetric,
    rpe: session.rpe,
  };
  if (session.notes) {
    row.notes = session.notes;
  }
  return [row];
}

export function normalizeSessionToRows(session: ActiveSession): SessionRow[] {
  switch (session.activityType) {
    case 'Lift':
      return normalizeLift(session);
    case 'Run':
      return normalizeRun(session);
    case 'Bike':
      return normalizeBike(session);
    case 'Swim':
      return normalizeSwim(session);
  }
}
