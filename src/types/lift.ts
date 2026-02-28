export interface Exercise {
  exercise: string;
  sets: number;
  repRange: string;
  /** @default "weight" */
  inputMode?: 'weight' | 'plates';
}

export interface Split {
  split: string;
  days: Record<string, Exercise[]>;
}
