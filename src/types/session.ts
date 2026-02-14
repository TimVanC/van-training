export interface LoggedSet {
  weight: number;
  reps: number;
  rir: number;
}

export interface SessionExercise {
  name: string;
  targetSets: number;
  targetReps: number;
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
