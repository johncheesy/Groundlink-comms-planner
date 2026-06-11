import { describe, it, expect } from 'vitest';
import { computeBadges } from './badges.js';

/**
 * computeBadges(state) — pure badge model (M20 §2).
 * Input: { objectCount, aoiSet, arsenalCount, stale }
 * Output: {
 *   modules: { objects?, aoi?, radios?, coverage? },   // key → badge or absent
 *   groups:  { mission?, radios?, analysis?, output? } // aggregates
 * }
 * Badge shape: { type: 'count'|'check'|'dot', value? }.
 * Aggregation: counts sum; a dot beats a check.
 */

const empty = { objectCount: 0, aoiSet: false, arsenalCount: 0, stale: false };

describe('computeBadges — per-module badges (M20 §2)', () => {
  it('empty app: radios shows "0", nothing else badged', () => {
    const b = computeBadges(empty);
    expect(b.modules.objects).toBeUndefined();
    expect(b.modules.aoi).toBeUndefined();
    expect(b.modules.radios).toEqual({ type: 'count', value: 0 });
    expect(b.modules.coverage).toBeUndefined();
  });

  it('objects → count; aoi → check when set', () => {
    const b = computeBadges({ ...empty, objectCount: 4, aoiSet: true });
    expect(b.modules.objects).toEqual({ type: 'count', value: 4 });
    expect(b.modules.aoi).toEqual({ type: 'check' });
  });

  it('radios → count when non-empty', () => {
    const b = computeBadges({ ...empty, arsenalCount: 3 });
    expect(b.modules.radios).toEqual({ type: 'count', value: 3 });
  });

  it('coverage → amber stale dot when the plan is dirty', () => {
    expect(computeBadges({ ...empty, stale: true }).modules.coverage).toEqual({ type: 'dot' });
    expect(computeBadges(empty).modules.coverage).toBeUndefined();
  });
});

describe('computeBadges — group aggregates', () => {
  it('mission group sums counts and carries the check', () => {
    const b = computeBadges({ ...empty, objectCount: 2, aoiSet: true });
    // counts win the value; the check rides along only when there is no count
    expect(b.groups.mission).toEqual({ type: 'count', value: 2 });
  });

  it('mission group shows a check when only the AOI is set', () => {
    const b = computeBadges({ ...empty, aoiSet: true });
    expect(b.groups.mission).toEqual({ type: 'check' });
  });

  it('analysis group: dot wins over everything when stale', () => {
    const b = computeBadges({ ...empty, stale: true });
    expect(b.groups.analysis).toEqual({ type: 'dot' });
  });

  it('radios group mirrors the radios count', () => {
    const b = computeBadges({ ...empty, arsenalCount: 5 });
    expect(b.groups.radios).toEqual({ type: 'count', value: 5 });
  });

  it('output group has no badge sources → absent', () => {
    const b = computeBadges({ ...empty, objectCount: 9, aoiSet: true, arsenalCount: 9, stale: true });
    expect(b.groups.output).toBeUndefined();
  });

  it('tolerates a missing state object', () => {
    expect(() => computeBadges(undefined)).not.toThrow();
  });
});
