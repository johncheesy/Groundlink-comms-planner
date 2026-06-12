import { describe, it, expect } from 'vitest';
import { erlangB, dmrCapacity } from './erlang.js';

describe('erlangB', () => {
  it('matches hand-computed recursion values', () => {
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 9); // A/(1+A)
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 9);
    expect(erlangB(5, 3)).toBeCloseTo(0.11005, 4);
  });

  it('zero channels block everything; zero load blocks nothing', () => {
    expect(erlangB(0, 5)).toBe(1);
    expect(erlangB(4, 0)).toBe(0);
  });

  it('blocking falls as channels are added and rises with load', () => {
    expect(erlangB(6, 3)).toBeLessThan(erlangB(3, 3));
    expect(erlangB(3, 6)).toBeGreaterThan(erlangB(3, 3));
  });

  it('returns NaN on bad input', () => {
    expect(erlangB(-1, 2)).toBeNaN();
    expect(erlangB(2, -1)).toBeNaN();
    expect(erlangB(NaN, 1)).toBeNaN();
  });
});

describe('dmrCapacity', () => {
  it('computes offered load = users × calls/h × holding time', () => {
    // 18 users × 4 calls/h × 20 s = 0.4 Erlangs
    const r = dmrCapacity({ users: 18, callsPerUserPerHour: 4, avgCallDurationSec: 20 });
    expect(r.load).toBeCloseTo(0.4, 9);
  });

  it('a light profile on 2 slots meets a 2% GoS target', () => {
    const r = dmrCapacity({ timeslots: 2, users: 10, callsPerUserPerHour: 4, avgCallDurationSec: 20 });
    expect(r.meetsTarget).toBe(true);
    expect(r.blocking).toBeLessThanOrEqual(0.02);
    expect(r.recommendation).toMatch(/Meets target/);
  });

  it('a heavy profile flags over-capacity and sizes the carriers needed', () => {
    const r = dmrCapacity({ timeslots: 2, users: 80, callsPerUserPerHour: 10, avgCallDurationSec: 30 });
    expect(r.meetsTarget).toBe(false);
    expect(r.neededSlots).toBeGreaterThan(2);
    expect(r.neededCarriers).toBe(Math.ceil(r.neededSlots / 2));
    expect(r.recommendation).toMatch(/Over capacity/);
  });

  it('zero traffic produces the sizing hint, not a division blow-up', () => {
    const r = dmrCapacity({ users: 0 });
    expect(r.load).toBe(0);
    expect(r.recommendation).toMatch(/No offered traffic/);
  });

  it('clamps a silly GoS target into (0.0001, 0.5]', () => {
    expect(dmrCapacity({ targetGoS: 0 }).targetGoS).toBe(0.0001);
    expect(dmrCapacity({ targetGoS: 0.9 }).targetGoS).toBe(0.5);
  });
});
