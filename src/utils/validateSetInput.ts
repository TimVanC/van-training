/** Max bar/plate total weight (lbs) allowed for a single set. */
export const MAX_LIFT_WEIGHT_LBS = 2000;

export const MIN_REPS = 1;
export const MAX_REPS = 50;

export interface SetFieldValidation {
  valid: boolean;
  message?: string;
}

/**
 * Validates reps for a logged set: whole number between MIN_REPS and MAX_REPS inclusive.
 */
export function validateReps(reps: number): SetFieldValidation {
  if (!Number.isFinite(reps)) {
    return { valid: false, message: 'Reps must be a valid number.' };
  }
  if (!Number.isInteger(reps)) {
    return { valid: false, message: 'Reps must be a whole number.' };
  }
  if (reps < MIN_REPS || reps > MAX_REPS) {
    return {
      valid: false,
      message: `Reps must be between ${MIN_REPS} and ${MAX_REPS}.`,
    };
  }
  return { valid: true };
}

/**
 * Validates total weight (lbs) for a set: finite, non-negative, not above max.
 */
export function validateLiftWeight(weight: number): SetFieldValidation {
  if (!Number.isFinite(weight)) {
    return { valid: false, message: 'Weight must be a valid number.' };
  }
  if (weight < 0) {
    return { valid: false, message: 'Weight cannot be negative.' };
  }
  if (weight > MAX_LIFT_WEIGHT_LBS) {
    return {
      valid: false,
      message: `Weight cannot exceed ${MAX_LIFT_WEIGHT_LBS} lbs.`,
    };
  }
  return { valid: true };
}
