export interface PlateBreakdown {
  plate45: number;
  plate35: number;
  plate25: number;
  plate10: number;
  plate5: number;
  sled: number;
}

const PLATE_NOTE_REGEX = /^\[plate_meta p45=(-?\d+(?:\.\d+)?);p35=(-?\d+(?:\.\d+)?);p25=(-?\d+(?:\.\d+)?);p10=(-?\d+(?:\.\d+)?);p5=(-?\d+(?:\.\d+)?);sled=(-?\d+(?:\.\d+)?)\]\s*/;

function normalizePlateCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function normalizeSled(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function formatPlateMetadata(plate: PlateBreakdown): string {
  return `[plate_meta p45=${normalizePlateCount(plate.plate45)};p35=${normalizePlateCount(plate.plate35)};p25=${normalizePlateCount(plate.plate25)};p10=${normalizePlateCount(plate.plate10)};p5=${normalizePlateCount(plate.plate5)};sled=${normalizeSled(plate.sled)}]`;
}

export function extractPlateMetadata(noteValue: unknown): {
  plateBreakdown?: PlateBreakdown;
  cleanedNote: string;
} {
  const note = String(noteValue ?? '').trim();
  if (!note) return { cleanedNote: '' };

  const match = note.match(PLATE_NOTE_REGEX);
  if (!match) return { cleanedNote: note };

  const plate45 = Number(match[1]);
  const plate35 = Number(match[2]);
  const plate25 = Number(match[3]);
  const plate10 = Number(match[4]);
  const plate5 = Number(match[5]);
  const sled = Number(match[6]);
  const cleanedNote = note.replace(PLATE_NOTE_REGEX, '').trim();

  if (![plate45, plate35, plate25, plate10, plate5, sled].every(Number.isFinite)) {
    return { cleanedNote: note };
  }

  return {
    plateBreakdown: {
      plate45: normalizePlateCount(plate45),
      plate35: normalizePlateCount(plate35),
      plate25: normalizePlateCount(plate25),
      plate10: normalizePlateCount(plate10),
      plate5: normalizePlateCount(plate5),
      sled: normalizeSled(sled),
    },
    cleanedNote,
  };
}
