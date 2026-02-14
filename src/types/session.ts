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
  startedAt: string;
}
