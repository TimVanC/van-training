export interface Exercise {
  exercise: string;
  sets: number;
  reps: number;
}

export interface Split {
  split: string;
  days: Record<string, Exercise[]>;
}
