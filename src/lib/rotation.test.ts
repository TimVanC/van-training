import { describe, expect, it } from 'vitest';
import { computeNextDayName, dayKind, describeSplitDays, pickActiveSplit } from './rotation';

describe('dayKind', () => {
  it('gives every day of a PPL/UL split its own kind', () => {
    const kinds = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Core'].map(dayKind);
    expect(kinds).toEqual(['push', 'pull', 'legs', 'upper', 'lower', 'core']);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('reads variants and falls back to other', () => {
    expect(dayKind('Legs + Shoulders')).toBe('legs');
    expect(dayKind('Push - B')).toBe('push');
    expect(dayKind('Core - Short')).toBe('core');
    expect(dayKind('Shouldies')).toBe('other');
  });
});

describe('computeNextDayName', () => {
  it('suggests the day that has gone longest without training', () => {
    expect(
      computeNextDayName([
        { name: 'Push', lastTrained: '2026-10-27' },
        { name: 'Pull', lastTrained: '2026-10-20' },
        { name: 'Legs', lastTrained: '2026-10-25' },
      ]),
    ).toBe('Pull');
  });

  it('puts never-trained days first and ignores Core', () => {
    expect(
      computeNextDayName([
        { name: 'Push', lastTrained: '2026-10-27' },
        { name: 'Core' },
        { name: 'Lower' },
      ]),
    ).toBe('Lower');
  });
});

describe('pickActiveSplit', () => {
  const splits = [
    { name: 'PPLs' },
    { name: 'Ascend with me?' },
    { name: 'PPL/UL', isPreferred: true },
  ];
  const sessions = [{ splitName: 'PPLs' }, { splitName: 'Ascend with me?' }];

  it('follows the starred split even when another was trained more recently', () => {
    expect(pickActiveSplit(splits, sessions)?.name).toBe('PPL/UL');
  });

  it('falls back to the most recently trained split when nothing is starred', () => {
    const unstarred = splits.map(({ name }) => ({ name }));
    expect(pickActiveSplit(unstarred, sessions)?.name).toBe('Ascend with me?');
  });

  it('skips sessions from splits that no longer exist', () => {
    const unstarred = splits.map(({ name }) => ({ name }));
    expect(pickActiveSplit(unstarred, [...sessions, { splitName: 'Deleted' }])?.name).toBe('Ascend with me?');
  });

  it('falls back to the first split for a brand-new user, and null with no splits', () => {
    expect(pickActiveSplit([{ name: 'Only' }], [])?.name).toBe('Only');
    expect(pickActiveSplit([], sessions)).toBeNull();
  });
});

describe('describeSplitDays', () => {
  it('collapses A/B variants and drops Core', () => {
    expect(describeSplitDays(['Push A', 'Pull A', 'Legs + Shoulders', 'Push B', 'Pull B', 'Core'])).toBe(
      'Push / Pull / Legs',
    );
  });

  it('lists every day type of a PPL/UL split in order', () => {
    expect(describeSplitDays(['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Core - Short'])).toBe(
      'Push / Pull / Legs / Upper / Lower',
    );
  });

  it('handles dashed names, casing and empty input', () => {
    expect(describeSplitDays(['Push - A', 'push - B', 'Shouldies'])).toBe('Push / Shouldies');
    expect(describeSplitDays([])).toBe('');
  });
});
