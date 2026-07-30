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
 * be suggested as "up next". Matches "Core" and variants like "Core - Full" /
 * "Core - Short", case-insensitively.
 */
export function isAccessoryDay(name: string): boolean {
  return name.trim().toLowerCase().startsWith('core');
}

/**
 * Returns the day that is "up next": the rotation day that hasn't been trained
 * for the longest. Never-trained days rank as the oldest, so they come first.
 * Accessory days (e.g. Core) are ignored entirely.
 *
 * This deliberately does NOT assume a fixed A→B sequence — people don't always
 * finish a full cycle before restarting, and sometimes start on the B days. So
 * "next" is simply whichever day has gone longest without being done. `days`
 * should be sorted by order_index so ties break toward the earlier day.
 *
 * `lastTrained` values must be comparable date strings (ISO); an empty/absent
 * value means never trained and sorts before any real date.
 */
export function computeNextDayName(days: RotationDay[]): string | null {
  const rotationDays = days.filter((day) => !isAccessoryDay(day.name));
  if (rotationDays.length === 0) return null;

  let best = rotationDays[0];
  let bestDate = best.lastTrained ?? '';
  for (const day of rotationDays.slice(1)) {
    const date = day.lastTrained ?? '';
    // Strictly-older wins; equal keeps the earlier order_index (stable).
    if (date < bestDate) {
      best = day;
      bestDate = date;
    }
  }
  return best.name;
}
