import { describe, it, expect } from 'vitest';
import { LIMITS, strictNum, isLatLng, clipName, decimate } from './validate.js';

describe('strictNum', () => {
  it('accepts numbers and numeric strings', () => {
    expect(strictNum(0)).toBe(0);
    expect(strictNum(-12.5)).toBe(-12.5);
    expect(strictNum('3.5')).toBe(3.5);
    expect(strictNum(' 7 ')).toBe(7);
  });
  it('rejects what Number() would silently turn into 0 or garbage', () => {
    for (const v of [null, undefined, '', '   ', true, false, 'abc', NaN, Infinity, {}, [], [1]]) expect(strictNum(v)).toBeNull();
  });
});

describe('isLatLng', () => {
  it('accepts the valid range including the edges', () => {
    for (const [a, b] of [[0, 0], [90, 180], [-90, -180], [52.37, 4.9]]) expect(isLatLng(a, b)).toBe(true);
  });
  it('rejects out of range and non-finite', () => {
    for (const [a, b] of [[91, 0], [0, 181], [-90.01, 0], [NaN, 1], [1, Infinity], [95, 400], [undefined, 1]]) expect(isLatLng(a, b)).toBe(false);
  });
});

describe('clipName', () => {
  it('trims, caps with an ellipsis, and tolerates non-strings', () => {
    expect(clipName('  Alpha  ')).toBe('Alpha');
    const long = clipName('x'.repeat(5000));
    expect(long.length).toBe(LIMITS.nameLen);
    expect(long.endsWith('…')).toBe(true);
    expect(clipName(null)).toBe('');
    expect(clipName(42)).toBe('');
  });
});

describe('decimate', () => {
  it('leaves short lists alone', () => {
    const a = [1, 2, 3];
    expect(decimate(a, 10)).toBe(a);
  });
  it('keeps first and last and the requested count', () => {
    const a = Array.from({ length: 10_000 }, (_, i) => i);
    const d = decimate(a, 2000);
    expect(d).toHaveLength(2000);
    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(9999);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
});

import { spanKm, missionSpanProblem, MAX_SPAN_KM } from './validate.js';

describe('spanKm / missionSpanProblem', () => {
  it('measures a small box', () => {
    expect(spanKm({ west: 4, east: 4.1, south: 52, north: 52.1 })).toBeCloseTo(13.05, 1);
    expect(spanKm(null)).toBe(0);
  });
  it('Amsterdam to Cape Town is far beyond one plan', () => {
    const msg = missionSpanProblem({ west: 4.9, east: 18.4, south: -33.9, north: 52.4 });
    expect(msg).toMatch(/spans about 9[0-9]{3} km/);
    expect(msg).toMatch(/800 km/);
  });
  it('a 200 km radius AOI is still allowed', () => {
    const lat = 52.37; const dLat = 200 / 111.32; const dLng = 200 / (111.32 * Math.cos((lat * Math.PI) / 180));
    expect(missionSpanProblem({ west: 4.9 - dLng, east: 4.9 + dLng, south: lat - dLat, north: lat + dLat })).toBeNull();
  });
  it('threshold is the exported maximum', () => {
    expect(MAX_SPAN_KM).toBe(800);
    expect(missionSpanProblem({ west: 0, east: 0.01, south: 0, north: 0.01 })).toBeNull();
  });
});
