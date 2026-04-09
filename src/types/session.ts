export interface PlateBreakdown {
  plate45: number;
  plate35: number;
  plate25: number;
  plate10: number;
  plate5: number;
  sled: number;
}

export interface RecentLift {
  weight: string | number;
  reps: string | number;
  rir: string | number;
  plateBreakdown?: PlateBreakdown;
}

export interface RecommendedPlanSet {
  setNumber: number;
  weight: number;
  targetReps: number;
  targetRIR: number;
}

export interface ProgressionMetrics {
  lastTopSetWeight?: number;
  lastTopSetReps?: number;
  estimatedOneRepMax?: number;
  totalReps?: number;
}

export interface RecentLiftsResponse {
  lastTrained?: string;
  sets: RecentLift[];
  previousNote?: string;
  recommendedPlan?: RecommendedPlanSet[] | null;
  progressionMetrics?: ProgressionMetrics;
}

export interface LoggedSet {
  weight: number;
  reps: number;
  rir: number;
  plate45?: number;
  plate35?: number;
  plate25?: number;
  plate10?: number;
  plate5?: number;
  sled?: number;
  plateData?: PlateBreakdown;
  /** Client-generated id for undo; not sent to Sheets */
  clientId?: string;
}

export interface SessionExercise {
  name: string;
  /** Session-only exercise name override used for swap substitutions */
  activeName?: string;
  targetSets: number;
  targetRepRange: string;
  /** @deprecated use targetRepRange; present only for sessions loaded from localStorage */
  targetReps?: number;
  /** @default "weight" */
  inputMode?: 'weight' | 'plates';
  sets: LoggedSet[];
  completed: boolean;
}

export interface LiftSession {
  activityType: 'Lift';
  split: string;
  day: string;
  exercises: SessionExercise[];
  notes?: string;
  startedAt: string;
}

export type EnduranceActivityType = 'Run' | 'Bike' | 'Swim';

export interface EnduranceSession {
  activityType: EnduranceActivityType;
  distance: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  derivedMetric: number;
  rpe: number;
  notes?: string;
  startedAt: string;
}

export type ActiveSession = LiftSession | EnduranceSession;
