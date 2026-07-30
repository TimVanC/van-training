/**
 * Maps exercise names to muscle groups. Names are free text in `lift_sets`
 * (including a few spelling variants like "Duel"/"Dual" and "Dealt"/"Delt"),
 * so classification is keyword-based and deliberately tolerant.
 *
 * Pure module — shared by the Vercel API functions and the client.
 */

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Calves',
  'Core',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface MuscleClassification {
  primary: MuscleGroup;
  /** Groups that assist; counted at half credit for volume purposes. */
  secondary: MuscleGroup[];
}

export function classifyExercise(exerciseName: string): MuscleClassification | null {
  const n = exerciseName.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));

  // Most specific first — several generic words ("extension", "raise", "curl",
  // "fly") belong to different groups depending on context.
  if (has('calf')) return { primary: 'Calves', secondary: [] };
  if (has('hamstring', 'romanian', 'rdl', 'leg curl', 'nordic', 'good morning')) {
    return { primary: 'Hamstrings', secondary: [] };
  }
  if (has('leg extension')) return { primary: 'Quads', secondary: [] };
  if (has('leg press', 'squat', 'sqaut', 'hack', 'lunge', 'bulgarian')) {
    return { primary: 'Quads', secondary: ['Hamstrings'] };
  }
  if (has('crunch', 'oblique', 'woodchop', 'knee raise', 'leg raise', 'plank', 'serratus', 'ab wheel', 'situp', 'sit-up', 'pallof', 'rollout', 'body saw', 'chair raise', 'landmine rotation', 'machine rotation')) {
    return { primary: 'Core', secondary: [] };
  }
  if (has('back extension', 'hyperextension', 'reverse hyper')) return { primary: 'Back', secondary: ['Hamstrings'] };

  if (has('rear delt', 'rear dealt', 'face pull', 'reverse fly', 'reverse pec')) {
    return { primary: 'Shoulders', secondary: [] };
  }
  if (has('lateral raise', 'lateral', 'front raise', 'shoulder press', 'overhead press', 'military', 'arnold')) {
    // Guard against names that mix shoulder and triceps words.
    if (!has('tricep', 'pushdown', 'push down')) {
      return has('press')
        ? { primary: 'Shoulders', secondary: ['Triceps'] }
        : { primary: 'Shoulders', secondary: [] };
    }
  }
  if (has('cable raise', 'duel cable raises', 'dual raise')) return { primary: 'Shoulders', secondary: [] };

  if (has('tricep', 'pushdown', 'push down', 'skullcrusher', 'skull crusher', 'katana', 'kickback')) {
    return { primary: 'Triceps', secondary: [] };
  }
  if (has('curl')) return { primary: 'Biceps', secondary: [] };

  if (has('row', 'pulldown', 'pull down', 'pull-up', 'pull up', 'chin-up', 'chin up', 'shrug', 'deadlift')) {
    return { primary: 'Back', secondary: ['Biceps'] };
  }
  // Word-boundary check so "flat press" doesn't match "lat".
  if (/\blat\b/.test(n)) return { primary: 'Back', secondary: ['Biceps'] };

  if (has('dip', 'push-up', 'push up', 'pushup')) return { primary: 'Chest', secondary: ['Triceps'] };
  if (has('pullover')) return { primary: 'Chest', secondary: ['Back'] };
  if (has('pec', 'chest', 'bench')) {
    return has('press') || has('dip')
      ? { primary: 'Chest', secondary: ['Triceps'] }
      : { primary: 'Chest', secondary: [] };
  }
  if (has('fly')) return { primary: 'Chest', secondary: [] };
  // Generic press with an incline/flat/decline qualifier is a chest press.
  if (has('press') && has('incline', 'flat', 'decline')) {
    return { primary: 'Chest', secondary: ['Triceps'] };
  }
  // A bare "extension" that survived every check above is almost always
  // a cable triceps extension in this catalog.
  if (has('extension')) return { primary: 'Triceps', secondary: [] };
  if (has('press')) return { primary: 'Chest', secondary: ['Triceps'] };

  return null;
}
