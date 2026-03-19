const ZERO_WIDTH_OR_BOM = /[\u200B-\u200D\uFEFF]/g;

export function normalizeExerciseName(name: unknown): string {
  return String(name ?? '')
    .replace(ZERO_WIDTH_OR_BOM, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canonicalExerciseToken(name: unknown): string {
  return normalizeExerciseName(name).replace(/[^a-z0-9]/g, '');
}

export function exerciseNamesMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeExerciseName(left);
  const normalizedRight = normalizeExerciseName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const canonicalLeft = canonicalExerciseToken(normalizedLeft);
  const canonicalRight = canonicalExerciseToken(normalizedRight);
  if (!canonicalLeft || !canonicalRight) return false;
  if (canonicalLeft === canonicalRight) return true;

  if (canonicalLeft.endsWith('s') && canonicalLeft.slice(0, -1) === canonicalRight) return true;
  if (canonicalRight.endsWith('s') && canonicalRight.slice(0, -1) === canonicalLeft) return true;

  return false;
}
