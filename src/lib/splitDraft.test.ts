import { describe, expect, it } from 'vitest';
import { MAX_DAYS, MAX_EXERCISES_PER_DAY, MAX_SETS, sanitizeSplitDraft } from './splitDraft';

const ok = (input: unknown) => {
  const result = sanitizeSplitDraft(input);
  if ('error' in result) throw new Error(`expected a draft, got: ${result.error}`);
  return result.draft;
};
const err = (input: unknown) => {
  const result = sanitizeSplitDraft(input);
  if ('draft' in result) throw new Error('expected an error');
  return result.error;
};

const day = (name: string, ...exercises: string[]) => ({
  name,
  exercises: exercises.map((n) => ({ name: n, sets: 3, repRange: '8-12' })),
});

describe('sanitizeSplitDraft', () => {
  it('passes a clean draft through unchanged', () => {
    const draft = { name: 'Upper Lower', days: [day('Upper', 'Bench Press', 'Row'), day('Lower', 'Squat')] };
    expect(ok(draft)).toEqual(draft);
  });

  it('trims and collapses whitespace in every name', () => {
    const draft = ok({ name: '  My   Split ', days: [{ name: ' Push  A ', exercises: [{ name: '  Incline   Press ', sets: 4, repRange: '6-8' }] }] });
    expect(draft.name).toBe('My Split');
    expect(draft.days[0].name).toBe('Push A');
    expect(draft.days[0].exercises[0].name).toBe('Incline Press');
  });

  it('rejects junk input, a missing name and reserved names', () => {
    expect(err(null)).toMatch(/No split/);
    expect(err('split')).toMatch(/No split/);
    expect(err({ name: '   ', days: [day('A', 'Squat')] })).toMatch(/name/);
    expect(err({ name: 'Import Split', days: [day('A', 'Squat')] })).toMatch(/reserved/);
    expect(err({ name: 'X', days: 'nope' })).toMatch(/at least one day/);
  });

  it('drops unnamed exercises and days left with nothing in them', () => {
    const draft = ok({
      name: 'X',
      days: [
        { name: 'Empty', exercises: [{ name: '  ', sets: 3, repRange: '8-12' }] },
        { name: 'Real', exercises: [{ name: 'Squat', sets: 3, repRange: '5' }, { name: '', sets: 3, repRange: '5' }] },
        'garbage',
      ],
    });
    expect(draft.days).toHaveLength(1);
    expect(draft.days[0].exercises.map((e) => e.name)).toEqual(['Squat']);
    expect(err({ name: 'X', days: [{ name: 'Empty', exercises: [] }] })).toMatch(/at least one day/);
  });

  it('clamps sets and repairs rep ranges', () => {
    const exercises = [
      { name: 'A', sets: 0, repRange: '8-12' },
      { name: 'B', sets: 99, repRange: '10' },
      { name: 'C', sets: 3.6, repRange: '8 to 12' },
      { name: 'D', sets: 'four', repRange: '12–15' },
      { name: 'E', sets: 3, repRange: 'AMRAP' },
      { name: 'F', sets: 3, repRange: '12-8' },
      { name: 'G', sets: 3, repRange: 10 },
      { name: 'H', sets: 3, repRange: '8-8' },
    ];
    const out = ok({ name: 'X', days: [{ name: 'Day', exercises }] }).days[0].exercises;
    expect(out.map((e) => e.sets)).toEqual([3, MAX_SETS, 4, 3, 3, 3, 3, 3]);
    expect(out.map((e) => e.repRange)).toEqual(['8-12', '10', '8-12', '12-15', '8-12', '8-12', '10', '8']);
  });

  it('makes duplicate day names unique and drops duplicate exercises within a day', () => {
    const draft = ok({ name: 'X', days: [day('Push', 'Bench', 'bench', 'Fly'), day('push', 'Dips'), day('Push', 'Press')] });
    expect(draft.days.map((d) => d.name)).toEqual(['Push', 'push 2', 'Push 3']);
    expect(draft.days[0].exercises.map((e) => e.name)).toEqual(['Bench', 'Fly']);
  });

  it('names unnamed days by position and bounds the size', () => {
    const many = Array.from({ length: MAX_DAYS + 5 }, () => ({
      name: '',
      exercises: Array.from({ length: MAX_EXERCISES_PER_DAY + 5 }, (_, i) => ({ name: `Ex ${i}`, sets: 3, repRange: '10' })),
    }));
    const draft = ok({ name: 'Big', days: many });
    expect(draft.days).toHaveLength(MAX_DAYS);
    expect(draft.days[0].name).toBe('Day 1');
    expect(draft.days[MAX_DAYS - 1].name).toBe(`Day ${MAX_DAYS}`);
    expect(draft.days[0].exercises).toHaveLength(MAX_EXERCISES_PER_DAY);
  });

  it('truncates over-long names instead of rejecting them', () => {
    const draft = ok({ name: 'S'.repeat(200), days: [{ name: 'D'.repeat(200), exercises: [{ name: 'E'.repeat(200), sets: 3, repRange: '10' }] }] });
    expect(draft.name).toHaveLength(60);
    expect(draft.days[0].name).toHaveLength(40);
    expect(draft.days[0].exercises[0].name).toHaveLength(80);
  });
});
