export interface LiftPlateData {
  plate45: number;
  plate35: number;
  plate25: number;
  plate10: number;
  sled: number;
}

export interface LiftRow {
  date: string;
  split: string;
  day: string;
  exercise: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number;
  plate_data?: LiftPlateData;
  notes?: string;
}

export interface RunRow {
  date: string;
  distance: number;
  timeSeconds: number;
  pacePerMile: number;
  rpe: number;
  notes?: string;
}

export interface BikeRow {
  date: string;
  distance: number;
  timeSeconds: number;
  avgSpeed: number;
  rpe: number;
  notes?: string;
}

export interface SwimRow {
  date: string;
  distance: number;
  timeSeconds: number;
  pacePer100: number;
  rpe: number;
  notes?: string;
}

export type SessionRow = LiftRow | RunRow | BikeRow | SwimRow;
