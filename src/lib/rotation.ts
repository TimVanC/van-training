/**
 * Split rotation: which day is up next?
 *
 * The next day is the one after the most recently trained day in the split's
 * configured order (wrapping around). Days that have never been trained don't
 * change the pointer — if nothing has ever been trained, the first day is next.
 */

export interface RotationDay {
  name: string;
  /** ISO date string of the last session for this day, if any. */
  lastTrained?: string;
}

/**
 * Accessory days are logged like any other workout but are NOT part of the
 * push/pull/legs cycle — training one shouldn't advance the rotation or ever
 * be suggested as "up next". Compared case-insensitively.
 */
const ACCESSORY_DAY_NAMES = new Set(['core']);

export function isAccessoryDay(name: string): boolean {
  return ACCESSORY_DAY_NAMES.has(name.trim().toLowerCase());
}

/**
 * Returns the next day in the rotation. `days` must already be sorted by the
 * split's order_index. Accessory days (e.g. Core) are ignored entirely: they
 * neither advance the rotation nor get returned as the next day.
 */
export function computeNextDayName(days: RotationDay[]): string | null {
  const rotationDays = days.filter((day) => !isAccessoryDay(day.name));
  if (rotationDays.length === 0) return null;

  let lastIndex = -1;
  let lastDate = '';
  for (let i = 0; i < rotationDays.length; i++) {
    const trained = rotationDays[i].lastTrained ?? '';
    if (!trained) continue;
    // On a tie (two days trained the same date), prefer the later day in the
    // split order so the rotation keeps moving forward.
    if (trained >= lastDate) {
      lastDate = trained;
      lastIndex = i;
    }
  }

  if (lastIndex === -1) return rotationDays[0].name;
  return rotationDays[(lastIndex + 1) % rotationDays.length].name;
}
