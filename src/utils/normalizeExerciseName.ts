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

function tokenizeExerciseName(name: unknown): string[] {
  return normalizeExerciseName(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token));
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

  // Handle cases like "weighted chest dips bw" vs "weighted chest dips".
  if (canonicalLeft.includes(canonicalRight) && (canonicalLeft.length - canonicalRight.length) <= 6) return true;
  if (canonicalRight.includes(canonicalLeft) && (canonicalRight.length - canonicalLeft.length) <= 6) return true;

  const leftTokens = new Set(tokenizeExerciseName(left));
  const rightTokens = new Set(tokenizeExerciseName(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const minTokenCount = Math.min(leftTokens.size, rightTokens.size);
  const overlapRatio = overlap / minTokenCount;
  if (overlap >= 2 && overlapRatio >= 0.75) return true;

  return false;
}
