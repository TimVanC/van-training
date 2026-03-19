const PLATE_MODE_EXERCISES = new Set([
  'Leg Press',
  'Flat Machine Chest Press',
  'Decline Machine Press',
  'Seated Calf Raise',
  'Hack Squat',
]);

export function usesPlateInputMode(exerciseName: string): boolean {
  return PLATE_MODE_EXERCISES.has(exerciseName.trim());
}
