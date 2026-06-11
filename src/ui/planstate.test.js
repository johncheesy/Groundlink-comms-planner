import { describe, it, expect } from 'vitest';
import { planState } from './planstate.js';

/**
 * planState(state) — pure selector for the toolbar stepper chip (M20 §1).
 * Input shape (gathered by main.js):
 *   { aoiSet, rfObjectCount, arsenalCount, hasResult, stale }
 * Output: { step: 1|2|3, done: { mission, radios, plan }, stale }
 */

const fresh = { aoiSet: false, rfObjectCount: 0, arsenalCount: 0, hasResult: false, stale: false };

describe('planState — step derivation (M20 §1)', () => {
  it('fresh app: step 1, nothing done', () => {
    const s = planState(fresh);
    expect(s.step).toBe(1);
    expect(s.done).toEqual({ mission: false, radios: false, plan: false });
    expect(s.stale).toBe(false);
  });

  it('mission done via AOI → step 2', () => {
    const s = planState({ ...fresh, aoiSet: true });
    expect(s.done.mission).toBe(true);
    expect(s.step).toBe(2);
  });

  it('mission done via a placed RF object (no AOI) → step 2', () => {
    const s = planState({ ...fresh, rfObjectCount: 1 });
    expect(s.done.mission).toBe(true);
    expect(s.step).toBe(2);
  });

  it('radios done once the arsenal is non-empty → step 3', () => {
    const s = planState({ ...fresh, aoiSet: true, arsenalCount: 2 });
    expect(s.done).toEqual({ mission: true, radios: true, plan: false });
    expect(s.step).toBe(3);
  });

  it('all done: a current result with mission + radios', () => {
    const s = planState({ aoiSet: true, rfObjectCount: 1, arsenalCount: 1, hasResult: true, stale: false });
    expect(s.done).toEqual({ mission: true, radios: true, plan: true });
    expect(s.step).toBe(3); // step never exceeds 3; all ticks shown via done
  });

  it('a stale result does not count as plan done', () => {
    const s = planState({ aoiSet: true, rfObjectCount: 0, arsenalCount: 1, hasResult: true, stale: true });
    expect(s.done.plan).toBe(false);
    expect(s.stale).toBe(true);
  });

  it('radios without mission keeps the current step at 1 (first undone)', () => {
    const s = planState({ ...fresh, arsenalCount: 3 });
    expect(s.done).toEqual({ mission: false, radios: true, plan: false });
    expect(s.step).toBe(1);
  });

  it('tolerates a missing/empty state object', () => {
    expect(planState(undefined).step).toBe(1);
    expect(planState({}).done).toEqual({ mission: false, radios: false, plan: false });
  });
});
