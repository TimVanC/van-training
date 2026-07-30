/**
 * Real-world weights for the fun "you moved X elephants" comparisons.
 * Values are approximate averages in pounds, ascending. The picker chooses
 * the heaviest item the total still covers at least once, so bigger training
 * totals unlock bigger comparisons.
 */

export interface WeightComparison {
  /** Singular display name. */
  name: string;
  /** Plural display name. */
  plural: string;
  lbs: number;
  emoji: string;
}

export const WEIGHT_COMPARISONS: WeightComparison[] = [
  { name: 'house cat', plural: 'house cats', lbs: 10, emoji: '🐈' },
  { name: 'gold bar', plural: 'gold bars', lbs: 27.5, emoji: '🪙' },
  { name: 'German Shepherd', plural: 'German Shepherds', lbs: 75, emoji: '🐕' },
  { name: 'adult human', plural: 'adult humans', lbs: 180, emoji: '🧍' },
  { name: 'silverback gorilla', plural: 'silverback gorillas', lbs: 400, emoji: '🦍' },
  { name: 'grizzly bear', plural: 'grizzly bears', lbs: 700, emoji: '🐻' },
  { name: 'grand piano', plural: 'grand pianos', lbs: 990, emoji: '🎹' },
  { name: 'dairy cow', plural: 'dairy cows', lbs: 1400, emoji: '🐄' },
  { name: 'velociraptor pack (10)', plural: 'velociraptor packs', lbs: 330, emoji: '🦖' },
  { name: 'hippo', plural: 'hippos', lbs: 3300, emoji: '🦛' },
  { name: 'pickup truck', plural: 'pickup trucks', lbs: 4500, emoji: '🛻' },
  { name: 'Tyrannosaurus rex', plural: 'Tyrannosaurus rexes', lbs: 15500, emoji: '🦖' },
  { name: 'African elephant', plural: 'African elephants', lbs: 13000, emoji: '🐘' },
  { name: 'Triceratops', plural: 'Triceratopses', lbs: 22000, emoji: '🦕' },
  { name: 'school bus', plural: 'school buses', lbs: 25000, emoji: '🚌' },
  { name: 'fire truck', plural: 'fire trucks', lbs: 60000, emoji: '🚒' },
  { name: 'pod of orcas (6)', plural: 'pods of orcas', lbs: 72000, emoji: '🐳' },
  { name: 'loaded semi truck', plural: 'loaded semi trucks', lbs: 80000, emoji: '🚛' },
  { name: 'Boeing 737', plural: 'Boeing 737s', lbs: 91000, emoji: '✈️' },
  { name: 'Brachiosaurus', plural: 'Brachiosauruses', lbs: 125000, emoji: '🦕' },
  { name: 'blue whale', plural: 'blue whales', lbs: 330000, emoji: '🐋' },
  { name: 'Statue of Liberty', plural: 'Statues of Liberty', lbs: 450000, emoji: '🗽' },
  { name: 'fully loaded Boeing 747', plural: 'fully loaded Boeing 747s', lbs: 875000, emoji: '🛫' },
  { name: 'International Space Station', plural: 'International Space Stations', lbs: 925000, emoji: '🛰️' },
  { name: 'Eiffel Tower', plural: 'Eiffel Towers', lbs: 22000000, emoji: '🗼' },
  { name: 'Titanic', plural: 'Titanics', lbs: 103000000, emoji: '🚢' },
  { name: 'Golden Gate Bridge', plural: 'Golden Gate Bridges', lbs: 1600000000, emoji: '🌉' },
].sort((a, b) => a.lbs - b.lbs);

export interface FunComparison {
  count: number;
  countLabel: string;
  item: WeightComparison;
}

/**
 * Best comparison for a total: the heaviest item covered at least once, so
 * the count stays in a satisfying 1–25 range. Totals below the smallest item
 * fall back to a fraction of it.
 */
export function funComparison(lbs: number): FunComparison | null {
  if (!Number.isFinite(lbs) || lbs <= 0) return null;
  let pick = WEIGHT_COMPARISONS[0];
  for (const item of WEIGHT_COMPARISONS) {
    if (lbs / item.lbs >= 1) pick = item;
    else break;
  }
  const count = lbs / pick.lbs;
  const countLabel =
    count >= 10 ? String(Math.round(count)) : count >= 1 ? count.toFixed(1).replace(/\.0$/, '') : count.toFixed(2);
  return { count, countLabel, item: pick };
}

/** "≈ 1.5 African elephants 🐘" */
export function funComparisonLabel(lbs: number): string | null {
  const c = funComparison(lbs);
  if (!c) return null;
  const noun = c.count >= 1.05 ? c.item.plural : c.item.name;
  return `≈ ${c.countLabel} ${noun} ${c.item.emoji}`;
}
