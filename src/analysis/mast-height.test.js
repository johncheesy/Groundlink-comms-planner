import { describe, it, expect } from 'vitest';
import { minHeightForLink, minHeightForLinks } from './mast-height.js';
import { earthBulgeM } from '../coverage/model.js';
import { fresnelRadius } from './path-profile.js';

/**
 * Synthetic geometry only (null-island offsets — no real coordinates).
 * One degree of longitude at the equator ≈ 111.3 km, so 0.09° ≈ 10 km.
 */
const TX = { lat: 0, lng: 0 };
const RX = { lat: 0, lng: 0.09 };

/**
 * Flat earth with a single knife-edge ridge at exact mid-path: with 121 steps
 * over 0.09°, only sample i = 60 (lng = 0.045) falls inside the band, so the
 * analytic mid-path formula applies exactly.
 */
const ridgeDem = (ridgeM) => ({
  sample: (lng) => (Math.abs(lng - 0.045) < 0.0004 ? ridgeM : 0),
});
const flatDem = { sample: () => 0 };

const BASE = { tx: TX, rx: RX, rxHeightM: 10, freqMHz: 1500, maxM: 250, steps: 121 };

describe('minHeightForLink — analytic single-ridge case', () => {
  it('matches the closed-form mid-path requirement within sampling tolerance', () => {
    const r = minHeightForLink({ ...BASE, dem: ridgeDem(60) });
    // At exact mid-path (t = 0.5): txTip = (60 + bulge + 0.6·r1 − rxTip·0.5)/0.5
    const D = r.profile.distanceM;
    const expected =
      (60 + earthBulgeM(D / 2, D / 2) + 0.6 * fresnelRadius(D / 2, D / 2, 1500) - 10 * 0.5) / 0.5;
    expect(Math.abs(r.heightM - expected)).toBeLessThan(0.5);
    expect(r.limited).toBe(false);
    expect(r.obstacle).not.toBeNull();
    // The blocking sample sits at the ridge, ~mid-path.
    expect(Math.abs(r.obstacle.distM - D / 2)).toBeLessThan(D * 0.02);
  });

  it('the returned height clears; half a metre less does not', () => {
    const r = minHeightForLink({ ...BASE, dem: ridgeDem(60) });
    expect(r.minClearanceM).toBeGreaterThanOrEqual(-1e-6);
    const below = minHeightForLink({ ...BASE, dem: ridgeDem(60), maxM: r.heightM - 0.5 });
    expect(below.limited).toBe(true);
    expect(below.minClearanceM).toBeLessThan(0);
  });

  it('a stricter Fresnel target demands a taller mast (100% > 60%)', () => {
    const at60 = minHeightForLink({ ...BASE, dem: ridgeDem(60), fraction: 0.6 });
    const at100 = minHeightForLink({ ...BASE, dem: ridgeDem(60), fraction: 1.0 });
    expect(at100.heightM).toBeGreaterThan(at60.heightM);
  });

  it('raising the rx antenna lowers the required tx height', () => {
    const lowRx = minHeightForLink({ ...BASE, dem: ridgeDem(60), rxHeightM: 2 });
    const highRx = minHeightForLink({ ...BASE, dem: ridgeDem(60), rxHeightM: 30 });
    expect(highRx.heightM).toBeLessThan(lowRx.heightM);
  });
});

describe('minHeightForLink — edges', () => {
  it('a short flat path returns the mounting minimum with clearance', () => {
    // 1 km — short enough that 60% Fresnel + bulge fit under the high rx end.
    // (Over 10 km flat at 1500 MHz the zone genuinely grazes the ground and
    // the engine correctly demands ~7 m; see the next assertion.)
    const r = minHeightForLink({ ...BASE, rx: { lat: 0, lng: 0.009 }, dem: flatDem, rxHeightM: 30, minM: 2, maxM: 30 });
    expect(r.heightM).toBe(2);
    expect(r.limited).toBe(false);
    expect(r.minClearanceM).toBeGreaterThanOrEqual(0);
    // Long flat path: Fresnel clearance, not terrain, sets the height.
    const long = minHeightForLink({ ...BASE, dem: flatDem, rxHeightM: 30, minM: 2, maxM: 30 });
    expect(long.heightM).toBeGreaterThan(2);
  });

  it('limited: reports best margin + the blocking obstacle instead of a false number', () => {
    const r = minHeightForLink({ ...BASE, dem: ridgeDem(60), maxM: 10 });
    expect(r.limited).toBe(true);
    expect(r.heightM).toBe(10); // capped, not the (unreachable) requirement
    expect(r.requiredM).toBeGreaterThan(100); // the honest number still reported
    expect(r.minClearanceM).toBeLessThan(0);
    expect(Math.abs(r.obstacle.distM - r.profile.distanceM / 2)).toBeLessThan(r.profile.distanceM * 0.02);
  });

  it('clutter heights raise the requirement; terminals stay bare', () => {
    const clutter = { heightM: () => 20 };
    const bare = minHeightForLink({ ...BASE, dem: flatDem, rxHeightM: 2 });
    const wooded = minHeightForLink({ ...BASE, dem: flatDem, rxHeightM: 2, clutter });
    expect(wooded.heightM).toBeGreaterThan(bare.heightM);
    expect(wooded.profile.clutterM[0]).toBe(0);
    expect(wooded.profile.clutterM.at(-1)).toBe(0);
    expect(wooded.profile.clutterM[5]).toBe(20);
  });

  it('guards: bad frequency / coincident endpoints throw', () => {
    expect(() => minHeightForLink({ tx: TX, rx: RX })).toThrow(RangeError);
    expect(() => minHeightForLink({ tx: TX, rx: TX, freqMHz: 150 })).toThrow(RangeError);
  });
});

describe('minHeightForLinks — binding link', () => {
  it('picks the tightest link and returns its height', () => {
    const links = [
      { rx: { lat: 0.06, lng: 0.0 }, rxHeightM: 10 }, // clear flat path
      { rx: RX, rxHeightM: 10 }, // behind the ridge
    ];
    const r = minHeightForLinks(links, { tx: TX, freqMHz: 1500, dem: ridgeDem(60), maxM: 250, steps: 121 });
    expect(r.bindingIndex).toBe(1);
    expect(r.heightM).toBe(r.results[1].heightM);
    expect(r.results[0].heightM).toBeLessThan(r.results[1].heightM);
  });

  it('throws on an empty link list', () => {
    expect(() => minHeightForLinks([], { tx: TX, freqMHz: 150 })).toThrow(RangeError);
  });
});
