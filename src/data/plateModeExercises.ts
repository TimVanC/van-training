function normalizeExerciseName(exerciseName: string): string {
  return exerciseName.trim().toLowerCase();
}

const PLATE_MODE_EXERCISES = new Set([
  'Leg Press',
  'Flat Machine Chest Press',
  'Decline Machine Press',
  'Seated Calf Raise',
  'Hack Squat',
].map(normalizeExerciseName));

const SLED_EXERCISES = new Set([
  'Leg Press',
  'Hack Squat',
].map(normalizeExerciseName));

const ASSISTED_EXERCISES = new Set([
  'Neutral Grip Pull-Ups',
  'Pull Ups',
  'Lat Pulldown',
  'Cable Crunches',
  'Hanging Knee Raises',
  'Oblique Crunch',
  'Serratus Crunch',
].map(normalizeExerciseName));

export function usesPlateInputMode(exerciseName: string): boolean {
  return PLATE_MODE_EXERCISES.has(normalizeExerciseName(exerciseName));
}

export function isSledExercise(exerciseName: string): boolean {
  return SLED_EXERCISES.has(normalizeExerciseName(exerciseName));
}

export function supportsAssistedMode(exerciseName: string): boolean {
  return ASSISTED_EXERCISES.has(normalizeExerciseName(exerciseName));
}
