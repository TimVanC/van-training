/**
 * Exercise → muscle knowledge base.
 *
 * Exercise names are free text in `lift_sets` (including a few spelling
 * variants like "Duel"/"Dual" and "Dealt"/"Delt"), so classification is
 * keyword-based and deliberately tolerant. Every exercise resolves to a
 * *profile*: the primary group it is programmed for, a fractional set credit
 * for every group it meaningfully loads (compound lifts spread credit across
 * their synergists — a bench press trains the front delts and triceps, not
 * just the chest), and a per-group emphasis across that group's heads.
 *
 * Credit convention (per logged set):
 *   1.00  primary mover
 *   0.50  strong synergist (triceps on a press, biceps on a row)
 *   0.33  moderate synergist (front delts on a flat bench, rear delts on a row)
 *   0.20  minor / stabiliser (upper traps on a lateral raise)
 *   0.10  trace, only where it is commonly programmed for (e.g. calves on a leg press)
 * Numbers follow standard EMG / biomechanics heuristics for training-balance
 * feedback; they are estimates, not clinical measurements.
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

/**
 * Regions ("heads") tracked within each group. Head-emphasis arrays below are
 * aligned with this order:
 *   Chest      [upper, mid, lower]
 *   Back       [lats, upper traps, mid-back, lower back]
 *   Shoulders  [front delt, side delt, rear delt]
 *   Biceps     [long/outer head, short/inner head, brachialis]
 *   Triceps    [long head, lateral head, medial head]
 *   Quads      [rectus femoris, outer quad (VL), inner quad (VMO)]
 *   Hamstrings [biceps femoris, semis, glutes]
 *   Calves     [gastrocnemius, soleus]
 *   Core       [upper abs, lower abs, obliques, serratus]
 */
export const MUSCLE_HEADS: Record<MuscleGroup, string[]> = {
  Chest: ['Upper Chest', 'Mid Chest', 'Lower Chest'],
  Back: ['Lats', 'Upper Traps', 'Mid-Back', 'Lower Back'],
  Shoulders: ['Front Delt', 'Side Delt', 'Rear Delt'],
  Biceps: ['Long (Outer) Head', 'Short (Inner) Head', 'Brachialis'],
  Triceps: ['Long Head', 'Lateral Head', 'Medial Head'],
  Quads: ['Rectus Femoris', 'Outer Quad (VL)', 'Inner Quad (VMO)'],
  Hamstrings: ['Biceps Femoris (Outer)', 'Semis (Inner)', 'Glutes'],
  Calves: ['Gastrocnemius', 'Soleus'],
  Core: ['Upper Abs', 'Lower Abs', 'Obliques', 'Serratus'],
};

export type MuscleLoad = Partial<Record<MuscleGroup, number>>;
export type HeadEmphasisMap = Partial<Record<MuscleGroup, readonly number[]>>;

export interface ExerciseProfile {
  /** The group the exercise is programmed for (used for grouping/trends). */
  primary: MuscleGroup;
  /** Fractional set credit per group; `primary` is always 1. */
  load: MuscleLoad;
  /**
   * Relative emphasis across each group's heads, aligned with MUSCLE_HEADS.
   * Groups missing here fall back to `defaultHeadEmphasis`.
   */
  heads: HeadEmphasisMap;
}

export interface MuscleClassification {
  primary: MuscleGroup;
  /** Every non-primary group that receives credit, strongest first. */
  secondary: MuscleGroup[];
  /** Fractional set credit per group (primary = 1). */
  load: MuscleLoad;
}

// ---------------------------------------------------------------------------
// Head-emphasis shorthands, aligned with MUSCLE_HEADS order.
// ---------------------------------------------------------------------------
const CHEST = {
  upper: [1, 0.5, 0.1],
  flat: [0.35, 1, 0.4],
  lower: [0.05, 0.5, 1],
  mid: [0.2, 1, 0.3],
  upperAssist: [1, 0.15, 0],
  lowerAssist: [0, 0.4, 1],
} as const;
const BACK = {
  lats: [1, 0, 0.3, 0],
  latsPure: [1, 0, 0.1, 0],
  rowMid: [0.5, 0.2, 1, 0.1],
  rowBarbell: [0.5, 0.25, 1, 0.45],
  upperTraps: [0, 1, 0.15, 0],
  midTraps: [0, 0.3, 1, 0],
  lowerBack: [0, 0.1, 0.2, 1],
  erectorsThoracic: [0, 0.2, 0.4, 1],
  deadlift: [0.3, 0.5, 0.45, 1],
  carry: [0.2, 1, 0.3, 0.3],
} as const;
const DELT = {
  front: [1, 0.1, 0],
  frontPure: [1, 0, 0],
  frontRaise: [1, 0.25, 0],
  press: [1, 0.4, 0],
  arnold: [1, 0.55, 0.05],
  side: [0.1, 1, 0.05],
  upright: [0.2, 1, 0.15],
  rear: [0, 0.1, 1],
  rearPure: [0, 0.05, 1],
  facePull: [0, 0.15, 1],
} as const;
const BI = {
  even: [0.7, 0.7, 0.35],
  longHead: [1, 0.4, 0.15],
  shortHead: [0.4, 1, 0.15],
  brachialis: [0.4, 0.1, 1],
  rowPronated: [0.35, 0.35, 0.7],
  rowSupinated: [0.6, 0.6, 0.35],
  neutralPull: [0.4, 0.25, 1],
  pronatedPull: [0.3, 0.25, 0.8],
  chinUp: [0.7, 0.7, 0.3],
} as const;
const TRI = {
  overhead: [1, 0.4, 0.4],
  skull: [0.8, 0.5, 0.5],
  pushdown: [0.2, 1, 0.7],
  rope: [0.3, 1, 0.7],
  reverseGrip: [0.2, 0.5, 1],
  kickback: [0.5, 1, 0.5],
  press: [0.2, 0.6, 0.8],
  closeGrip: [0.3, 0.6, 0.9],
  jmPress: [0.4, 0.7, 0.9],
  longHeadOnly: [1, 0.05, 0],
  even: [0.5, 0.5, 0.5],
} as const;
const QUAD = {
  extension: [1, 0.6, 0.6],
  squat: [0.4, 1, 0.8],
  frontLoaded: [0.5, 0.9, 1],
  press: [0.3, 1, 0.8],
  hack: [0.35, 1, 0.9],
  lunge: [0.4, 0.8, 1],
  hinge: [0.3, 1, 0.7],
  hipFlexor: [1, 0, 0],
  adductor: [0.1, 0.1, 1],
} as const;
const HAM = {
  lyingCurl: [1, 0.8, 0],
  seatedCurl: [0.7, 1, 0],
  hinge: [0.8, 0.8, 1],
  gluteDominant: [0.3, 0.2, 1],
  glutePure: [0.1, 0.1, 1],
  squatAssist: [0.3, 0.2, 1],
  deadliftAssist: [0.7, 0.7, 1],
  backExtAssist: [0.6, 0.6, 1],
} as const;
const CALF = {
  standing: [1, 0.4],
  seated: [0.3, 1],
  gastroc: [1, 0.1],
  even: [0.7, 0.7],
} as const;
const CORE = {
  serratus: [0, 0, 0, 1],
  rotation: [0.2, 0.2, 1, 0.2],
  lowerAbs: [0.3, 1, 0.15, 0.1],
  antiExtension: [0.7, 0.7, 0.2, 0.4],
  crunch: [1, 0.4, 0.1, 0.1],
  brace: [0.3, 0.3, 0.6, 0],
  carry: [0.3, 0.3, 0.8, 0],
  pushUp: [0.3, 0.3, 0.1, 0.6],
} as const;

function profile(primary: MuscleGroup, load: MuscleLoad, heads: HeadEmphasisMap): ExerciseProfile {
  return { primary, load: { [primary]: 1, ...load }, heads };
}

/** Resolve the full muscle profile for a free-text exercise name. */
export function exerciseProfile(exerciseName: string): ExerciseProfile | null {
  const n = exerciseName.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  const word = (re: RegExp) => re.test(n);

  // ------------------------------------------------------------------ Calves
  if (has('calf', 'calves', 'tibialis')) {
    const seated = has('seated');
    return profile('Calves', {}, { Calves: seated ? CALF.seated : CALF.standing });
  }

  // -------------------------------------------------------------------- Core
  // Core first: several core movements borrow words from other groups
  // ("cable crunch", "pallof press", "decline sit-up", "landmine rotation").
  if (has('serratus')) {
    return profile('Core', { Chest: 0.15 }, { Core: CORE.serratus, Chest: CHEST.mid });
  }
  if (has('woodchop', 'wood chop', 'pallof', 'oblique', 'side bend', 'twist', 'russian', 'landmine rotation', 'machine rotation', 'torso rotation', 'cable rotation')) {
    return profile('Core', {}, { Core: CORE.rotation });
  }
  if (has('knee raise', 'leg raise', 'reverse crunch', 'chair raise', 'toes to bar', 'toes-to-bar', 'hanging raise', 'v-up', 'v up', 'flutter', 'scissor')) {
    // Hip flexors (rectus femoris) do real work in any leg-lifting ab move.
    return profile('Core', { Quads: 0.25 }, { Core: CORE.lowerAbs, Quads: QUAD.hipFlexor });
  }
  if (has('rollout', 'roll out', 'ab wheel', 'body saw', 'plank', 'dead bug', 'hollow', 'stir the pot')) {
    const rollout = has('rollout', 'roll out', 'ab wheel', 'body saw');
    return profile(
      'Core',
      rollout ? { Back: 0.2, Triceps: 0.15 } : {},
      { Core: CORE.antiExtension, Back: BACK.latsPure, Triceps: TRI.longHeadOnly },
    );
  }
  if (has('crunch', 'situp', 'sit-up', 'sit up')) {
    const hipFlexion = has('situp', 'sit-up', 'sit up', 'decline');
    return profile('Core', hipFlexion ? { Quads: 0.2 } : {}, { Core: CORE.crunch, Quads: QUAD.hipFlexor });
  }
  if (has('farmer', 'carry', 'suitcase', 'yoke')) {
    return profile('Core', { Back: 0.5 }, { Core: CORE.carry, Back: BACK.carry });
  }

  // ------------------------------------------------------------------- Hinges
  if (has('nordic', 'leg curl', 'hamstring curl', 'ham curl', 'lying curl', 'seated curl', 'glute ham', 'ghr')) {
    const seated = has('seated');
    // Gastrocnemius crosses the knee and assists knee flexion, most on lying curls.
    return profile(
      'Hamstrings',
      { Calves: seated ? 0.1 : 0.2 },
      { Hamstrings: seated ? HAM.seatedCurl : HAM.lyingCurl, Calves: CALF.gastroc },
    );
  }
  if (has('hip thrust', 'glute bridge', 'glute', 'frog pump', 'pull through', 'pull-through', 'abduction', 'abductor')) {
    const abduction = has('abduction', 'abductor');
    return profile(
      'Hamstrings',
      abduction ? {} : { Quads: 0.2, Core: 0.1 },
      { Hamstrings: abduction ? HAM.glutePure : HAM.gluteDominant, Quads: QUAD.squat, Core: CORE.brace },
    );
  }
  if (has('adduction', 'adductor')) {
    // No dedicated inner-thigh group; adductors read as "inner thigh" to a
    // lifter, so they are tracked against the inner-quad head.
    return profile('Quads', {}, { Quads: QUAD.adductor });
  }
  if (has('romanian', 'rdl', 'stiff leg', 'stiff-leg', 'straight leg deadlift', 'good morning')) {
    return profile(
      'Hamstrings',
      { Back: 0.5, Core: 0.15 },
      { Hamstrings: HAM.hinge, Back: BACK.lowerBack, Core: CORE.brace },
    );
  }
  if (has('back extension', 'hyperextension', 'hyper extension', 'reverse hyper', '45 degree')) {
    const reverse = has('reverse');
    return profile(
      'Back',
      { Hamstrings: reverse ? 0.75 : 0.6 },
      { Back: BACK.lowerBack, Hamstrings: reverse ? HAM.gluteDominant : HAM.backExtAssist },
    );
  }
  if (has('deadlift')) {
    // Conventional / trap bar / sumo. Hip hinge with a big posterior chain
    // and erector demand; quads contribute more as the stance widens or the
    // handles rise (trap bar, sumo).
    const quadHeavy = has('trap bar', 'trapbar', 'hex bar', 'sumo', 'deficit');
    return profile(
      'Back',
      { Hamstrings: 0.75, Quads: quadHeavy ? 0.6 : 0.4, Core: 0.25 },
      { Back: BACK.deadlift, Hamstrings: HAM.deadliftAssist, Quads: QUAD.hinge, Core: CORE.brace },
    );
  }

  // -------------------------------------------------------------- Knee-dominant
  if (has('leg extension', 'sissy')) {
    return profile('Quads', {}, { Quads: QUAD.extension });
  }
  if (has('lunge', 'bulgarian', 'split squat', 'step up', 'step-up', 'stepup', 'pistol')) {
    return profile(
      'Quads',
      { Hamstrings: 0.6, Core: 0.15 },
      { Quads: QUAD.lunge, Hamstrings: HAM.gluteDominant, Core: CORE.brace },
    );
  }
  if (has('leg press')) {
    return profile(
      'Quads',
      { Hamstrings: 0.4, Calves: 0.1 },
      { Quads: QUAD.press, Hamstrings: HAM.squatAssist, Calves: CALF.even },
    );
  }
  if (has('hack', 'pendulum', 'belt squat', 'v-squat', 'v squat')) {
    return profile(
      'Quads',
      { Hamstrings: 0.33, Back: 0.1 },
      { Quads: QUAD.hack, Hamstrings: HAM.squatAssist, Back: BACK.lowerBack },
    );
  }
  if (has('squat', 'sqaut')) {
    const frontLoaded = has('front', 'goblet', 'zercher', 'safety bar', 'ssb');
    return profile(
      'Quads',
      { Hamstrings: 0.5, Back: frontLoaded ? 0.3 : 0.25, Core: frontLoaded ? 0.3 : 0.2, Calves: 0.1 },
      {
        Quads: frontLoaded ? QUAD.frontLoaded : QUAD.squat,
        Hamstrings: HAM.squatAssist,
        Back: frontLoaded ? BACK.erectorsThoracic : BACK.lowerBack,
        Core: CORE.brace,
        Calves: CALF.even,
      },
    );
  }

  // --------------------------------------------------------------- Shoulders
  if (has('face pull', 'facepull')) {
    return profile('Shoulders', { Back: 0.5 }, { Shoulders: DELT.facePull, Back: BACK.midTraps });
  }
  if (has('rear delt', 'rear dealt', 'reverse fly', 'reverse flye', 'reverse pec', 'rear fly', 'rear flye', 'bent over fly', 'bent-over fly')) {
    return profile('Shoulders', { Back: 0.33 }, { Shoulders: DELT.rear, Back: BACK.midTraps });
  }
  if (has('external rotation', 'internal rotation', 'rotator cuff', 'cuban')) {
    return profile('Shoulders', { Back: 0.2 }, { Shoulders: DELT.rearPure, Back: BACK.midTraps });
  }
  if (has('upright row')) {
    return profile(
      'Shoulders',
      { Back: 0.5, Biceps: 0.2 },
      { Shoulders: DELT.upright, Back: BACK.upperTraps, Biceps: BI.brachialis },
    );
  }
  if (has('lateral raise', 'lateral', 'lean-away', 'lean away', 'side raise', 'y raise', 'y-raise')) {
    // Upper traps take over above shoulder height, especially with dumbbells.
    return profile('Shoulders', { Back: 0.2 }, { Shoulders: DELT.side, Back: BACK.upperTraps });
  }
  if (has('front raise')) {
    return profile('Shoulders', { Chest: 0.15 }, { Shoulders: DELT.frontRaise, Chest: CHEST.upperAssist });
  }
  const isShoulderPress =
    has('shoulder press', 'military', 'arnold', 'push press', 'landmine press', 'z press', 'viking press', 'behind the neck') ||
    (has('overhead') && has('press'));
  if (isShoulderPress) {
    const landmine = has('landmine');
    const standing = has('standing', 'push press', 'military', 'landmine');
    return profile(
      'Shoulders',
      { Triceps: 0.5, Chest: landmine ? 0.4 : 0.25, Back: 0.2, Core: standing ? 0.25 : 0.15 },
      {
        Shoulders: has('arnold') ? DELT.arnold : DELT.press,
        Triceps: TRI.press,
        Chest: CHEST.upperAssist,
        Back: BACK.upperTraps,
        Core: CORE.brace,
      },
    );
  }
  if (has('cable raise', 'duel cable raise', 'dual cable raise', 'dual raise', 'duel raise')) {
    return profile('Shoulders', { Back: 0.2 }, { Shoulders: DELT.side, Back: BACK.upperTraps });
  }

  // ----------------------------------------------------------------- Triceps
  if (has('bench dip')) {
    return profile(
      'Triceps',
      { Chest: 0.33, Shoulders: 0.33 },
      { Triceps: TRI.closeGrip, Chest: CHEST.lowerAssist, Shoulders: DELT.frontPure },
    );
  }
  if (has('jm press') || (has('close grip', 'close-grip') && has('bench', 'press'))) {
    return profile(
      'Triceps',
      { Chest: 0.6, Shoulders: 0.33 },
      { Triceps: has('jm') ? TRI.jmPress : TRI.closeGrip, Chest: CHEST.mid, Shoulders: DELT.frontPure },
    );
  }
  if (has('kickback')) {
    return profile('Triceps', {}, { Triceps: TRI.kickback });
  }
  if (has('skull', 'french', 'katana', 'nosebreaker') || (has('overhead') && has('tricep', 'extension'))) {
    return profile('Triceps', {}, { Triceps: has('skull', 'nosebreaker') ? TRI.skull : TRI.overhead });
  }
  if (has('tricep', 'pushdown', 'push down', 'pressdown', 'press down')) {
    let heads: readonly number[] = TRI.pushdown;
    if (has('reverse', 'underhand', 'supinated')) heads = TRI.reverseGrip;
    else if (has('rope')) heads = TRI.rope;
    else if (has('overhead')) heads = TRI.overhead;
    else if (has('dual', 'duel', 'cross')) heads = TRI.even;
    return profile('Triceps', {}, { Triceps: heads });
  }

  // ------------------------------------------------------------------ Biceps
  if (has('curl')) {
    let heads: readonly number[] = BI.even;
    if (has('hammer', 'reverse', 'rope', 'zottman', 'cross-body', 'cross body', 'neutral')) heads = BI.brachialis;
    else if (has('incline', 'bayesian', 'drag', 'behind')) heads = BI.longHead;
    else if (has('preacher', 'spider', 'concentration', 'wide')) heads = BI.shortHead;
    else if (has('close', 'narrow')) heads = BI.longHead;
    return profile('Biceps', {}, { Biceps: heads });
  }

  // -------------------------------------------------------------------- Back
  if (has('shrug')) {
    return profile('Back', {}, { Back: BACK.upperTraps });
  }
  if (has('pullover', 'straight arm', 'straight-arm', 'stiff arm')) {
    const dumbbell = has('dumbbell', 'db ', 'bench');
    if (dumbbell) {
      // Lying DB pullover: chest and lats share the load, long-head triceps
      // and serratus stabilise.
      return profile(
        'Chest',
        { Back: 0.75, Triceps: 0.33, Core: 0.25 },
        { Chest: [0.3, 1, 0.5], Back: BACK.latsPure, Triceps: TRI.longHeadOnly, Core: CORE.serratus },
      );
    }
    return profile(
      'Back',
      { Triceps: 0.33, Chest: 0.25, Core: 0.15 },
      { Back: BACK.latsPure, Triceps: TRI.longHeadOnly, Chest: CHEST.lowerAssist, Core: CORE.serratus },
    );
  }
  if (has('row')) {
    const barbell = has('barbell', 'bb ', 'pendlay', 't-bar', 't bar', 'bent over', 'bent-over', 'meadows');
    const supinated = has('underhand', 'supinated', 'reverse grip');
    const rearDeltBias = has('high row', 'wide', 'rear');
    return profile(
      'Back',
      { Biceps: 0.5, Shoulders: rearDeltBias ? 0.5 : 0.33, ...(barbell ? { Hamstrings: 0.15, Core: 0.15 } : {}) },
      {
        Back: barbell ? BACK.rowBarbell : BACK.rowMid,
        Biceps: supinated ? BI.rowSupinated : BI.rowPronated,
        Shoulders: DELT.rearPure,
        Hamstrings: HAM.hinge,
        Core: CORE.brace,
      },
    );
  }
  if (has('pulldown', 'pull down', 'pull-up', 'pull up', 'pullup', 'chin-up', 'chin up', 'chinup', 'chins', 'muscle up') || word(/\blat\b/)) {
    const supinated = has('chin-up', 'chin up', 'chinup', 'chins', 'underhand', 'supinated', 'reverse grip');
    const neutral = has('neutral', 'hammer', 'v-bar', 'v bar', 'close grip', 'close-grip');
    const bodyweight = has('pull-up', 'pull up', 'pullup', 'chin-up', 'chin up', 'chinup', 'muscle up');
    return profile(
      'Back',
      { Biceps: supinated ? 0.6 : 0.5, Shoulders: 0.2, Triceps: 0.15, ...(bodyweight ? { Core: 0.15 } : {}) },
      {
        Back: BACK.lats,
        Biceps: supinated ? BI.chinUp : neutral ? BI.neutralPull : BI.pronatedPull,
        Shoulders: DELT.rearPure,
        Triceps: TRI.longHeadOnly,
        Core: CORE.antiExtension,
      },
    );
  }

  // ------------------------------------------------------------------- Chest
  if (has('dip')) {
    return profile(
      'Chest',
      { Triceps: 0.6, Shoulders: 0.33 },
      { Chest: CHEST.lower, Triceps: TRI.press, Shoulders: DELT.frontPure },
    );
  }
  if (has('push-up', 'push up', 'pushup', 'press-up', 'press up')) {
    return profile(
      'Chest',
      { Triceps: 0.5, Shoulders: 0.33, Core: 0.25 },
      { Chest: has('decline') ? CHEST.upper : [0.2, 1, 0.4], Triceps: TRI.press, Shoulders: DELT.frontPure, Core: CORE.pushUp },
    );
  }
  const isFly = has('fly', 'flye', 'pec deck', 'pec dec', 'crossover', 'cross over', 'svend', 'squeeze');
  if (isFly) {
    let heads: readonly number[] = CHEST.mid;
    if (has('incline', 'low to high', 'low-to-high')) heads = CHEST.upper;
    else if (has('decline', 'high to low', 'high-to-low')) heads = CHEST.lower;
    // Front delts assist horizontal adduction; short-head biceps stabilises.
    return profile('Chest', { Shoulders: 0.2, Biceps: 0.1 }, { Chest: heads, Shoulders: DELT.frontPure, Biceps: BI.shortHead });
  }
  const isChestPress =
    has('bench', 'chest press', 'pec', 'floor press', 'chest') ||
    (has('press') && has('incline', 'flat', 'decline', 'machine', 'dumbbell', 'db ', 'barbell', 'bb ', 'smith'));
  if (isChestPress || has('press')) {
    const incline = has('incline', 'low to high');
    const decline = has('decline', 'high to low');
    const chestHeads = incline ? CHEST.upper : decline ? CHEST.lower : CHEST.flat;
    // Front delts do more as the bench inclines; triceps do more as it declines.
    const frontDelt = incline ? 0.6 : decline ? 0.25 : 0.4;
    const triceps = decline ? 0.6 : 0.5;
    return profile(
      'Chest',
      { Triceps: triceps, Shoulders: frontDelt },
      { Chest: chestHeads, Triceps: TRI.press, Shoulders: DELT.front },
    );
  }
  // A bare "extension" that survived every check above is almost always a
  // cable triceps extension in this catalog.
  if (has('extension')) {
    return profile('Triceps', {}, { Triceps: TRI.even });
  }
  if (has('raise')) {
    return profile('Shoulders', { Back: 0.2 }, { Shoulders: DELT.side, Back: BACK.upperTraps });
  }

  return null;
}

/** Fallback head emphasis when an exercise profile has none for `group`. */
export function defaultHeadEmphasis(group: MuscleGroup): number[] {
  switch (group) {
    case 'Chest': return [0.33, 0.34, 0.33];
    case 'Back': return [0.4, 0.2, 0.3, 0.1];
    case 'Shoulders': return [0.33, 0.34, 0.33];
    case 'Biceps': return [0.5, 0.4, 0.4];
    case 'Triceps': return [0.5, 0.5, 0.5];
    case 'Quads': return [0.5, 0.7, 0.6];
    case 'Hamstrings': return [0.6, 0.6, 0.4];
    case 'Calves': return [0.7, 0.7];
    case 'Core': return [0.4, 0.4, 0.1, 0.1];
  }
}

/** Relative emphasis of `exerciseName` across `group`'s heads. */
export function headEmphasis(group: MuscleGroup, exerciseName: string): number[] {
  const heads = exerciseProfile(exerciseName)?.heads[group];
  return heads ? [...heads] : defaultHeadEmphasis(group);
}

/**
 * Backwards-compatible classification: primary group, the ordered list of
 * assisting groups, and the fractional credit for each.
 */
export function classifyExercise(exerciseName: string): MuscleClassification | null {
  const p = exerciseProfile(exerciseName);
  if (!p) return null;
  const secondary = (Object.entries(p.load) as Array<[MuscleGroup, number]>)
    .filter(([group, weight]) => group !== p.primary && weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([group]) => group);
  return { primary: p.primary, secondary, load: p.load };
}
