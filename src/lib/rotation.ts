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

/** `days` must already be sorted by the split's order_index. */
export function computeNextDayName(days: RotationDay[]): string | null {
  if (days.length === 0) return null;

  let lastIndex = -1;
  let lastDate = '';
  for (let i = 0; i < days.length; i++) {
    const trained = days[i].lastTrained ?? '';
    if (!trained) continue;
    // On a tie (two days trained the same date), prefer the later day in the
    // split order so the rotation keeps moving forward.
    if (trained >= lastDate) {
      lastDate = trained;
      lastIndex = i;
    }
  }

  if (lastIndex === -1) return days[0].name;
  return days[(lastIndex + 1) % days.length].name;
}
