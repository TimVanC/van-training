import type { LiftSession } from '../types/session';
import type { LiftRow } from '../types/rows';
import { isSledExercise } from '../data/plateModeExercises';

function normalizeLift(session: LiftSession): LiftRow[] {
  const date = session.startedAt;
  const rows: LiftRow[] = [];

  for (const exercise of session.exercises) {
    const selectedExerciseName = exercise.activeName ?? exercise.name;
    for (let i = 0; i < exercise.sets.length; i++) {
      const set = exercise.sets[i];
      const row: LiftRow = {
        date,
        split: session.split,
        day: session.day,
        exercise: selectedExerciseName,
        setNumber: i + 1,
        weight: set.weight,
        reps: set.reps,
        rir: set.rir,
      };
      const isPlatesMode = exercise.inputMode === 'plates';
      const includeSled = isSledExercise(selectedExerciseName);
      const plateData = set.plateData ?? {
        plate45: Number(set.plate45),
        plate35: Number(set.plate35),
        plate25: Number(set.plate25),
        plate10: Number(set.plate10),
        plate5: Number(set.plate5),
        plate2_5: Number(set.plate2_5 ?? 0),
        sled: Number(set.sled ?? 0),
      };
      const hasPlateData = isPlatesMode
        && Number.isFinite(plateData.plate45)
        && Number.isFinite(plateData.plate35)
        && Number.isFinite(plateData.plate25)
        && Number.isFinite(plateData.plate10)
        && Number.isFinite(plateData.plate5)
        && (includeSled ? Number.isFinite(plateData.sled) : true);
      const sessionNote = session.notes?.trim() ?? '';

      if (hasPlateData) {
        const plate2_5 = Number.isFinite(plateData.plate2_5) ? plateData.plate2_5 : 0;
        row.plate_data = {
          '45': plateData.plate45,
          '35': plateData.plate35,
          '25': plateData.plate25,
          '10': plateData.plate10,
          '5': plateData.plate5,
          ...(plate2_5 > 0 ? { '2.5': plate2_5 } : {}),
          ...(includeSled ? { sled: plateData.sled } : {}),
        };
      }

      if (sessionNote) {
        row.notes = sessionNote;
      }
      rows.push(row);
    }
  }

  return rows;
}

export function normalizeSessionToRows(session: LiftSession): LiftRow[] {
  return normalizeLift(session);
}
