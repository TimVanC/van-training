export interface Exercise {
  exercise: string;
  sets: number;
  repRange: string;
}

export interface Split {
  split: string;
  days: Record<string, Exercise[]>;
}
