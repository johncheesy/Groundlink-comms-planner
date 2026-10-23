import { describe, it, expect } from 'vitest';
import { aoiAlpha, applyAlpha, distanceOutsideM, fadeMarginM } from './aoi-fade.js';

// 1° lat ≈ 111.32 km; at lat 52 1° lng ≈ 68.5 km.
const radius = { type: 'radius', center: { lat: 52, lng: 5 }, radiusM: 4000 };
const square = { type: 'polygon', ring: [[4.95, 51.97], [5.05, 51.97], [5.05, 52.03], [4.95, 52.03], [4.95, 51.97]] };

describe('fadeMarginM', () => {
  it('is a quarter of the size, clamped to 400 m – 5 km', () => {
    expect(fadeMarginM(radius)).toBe(1000);
    expect(fadeMarginM({ type: 'radius', center: { lat: 0, lng: 0 }, radiusM: 500 })).toBe(400);
    expect(fadeMarginM({ type: 'radius', center: { lat: 0, lng: 0 }, radiusM: 50000 })).toBe(5000);
    expect(fadeMarginM(square)).toBeGreaterThan(900);
    expect(fadeMarginM(null)).toBe(0);
  });
});

describe('distanceOutsideM', () => {
  it('is 0 inside a radius and grows linearly outside', () => {
    expect(distanceOutsideM(radius, 5, 52)).toBe(0);
    expect(distanceOutsideM(radius, 5, 52.05)).toBeCloseTo(5566 - 4000, -2);
  });
  it('is 0 inside a polygon and the distance to the nearest edge outside', () => {
    expect(distanceOutsideM(square, 5, 52)).toBe(0);
    // 0.01° north of the top edge ≈ 1113 m
    expect(distanceOutsideM(square, 5, 52.04)).toBeCloseTo(1113, -2);
    // diagonal from the NE corner
    expect(distanceOutsideM(square, 5.06, 52.04)).toBeGreaterThan(1113);
  });
});

describe('aoiAlpha', () => {
  const bounds = { west: 4.8, east: 5.2, south: 51.9, north: 52.1 };
  it('is null without an AOI or with a degenerate one', () => {
    expect(aoiAlpha(bounds, 10, 10, null)).toBeNull();
    expect(aoiAlpha(bounds, 10, 10, { type: 'polygon', ring: [[0, 0]] })).toBeNull();
  });
  it('is 1 inside, 0 past the margin and in between on the ramp', () => {
    const cols = 41, rows = 21;
    const a = aoiAlpha(bounds, cols, rows, radius, 2000);
    const at = (lng, lat) => a[Math.floor((bounds.north - lat) / ((bounds.north - bounds.south) / rows)) * cols + Math.floor((lng - bounds.west) / ((bounds.east - bounds.west) / cols))];
    expect(at(5, 52)).toBe(1);
    expect(at(4.81, 51.91)).toBe(0); // far corner of the window
    const mid = at(5, 52.045); // ~5000 m from centre → 1000 m outside → half-way on a 2 km ramp
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });
});

describe('applyAlpha', () => {
  it('scales only the alpha channel and leaves alpha 1 cells alone', () => {
    const data = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 200, 7, 8, 9, 255]);
    applyAlpha(data, new Float32Array([1, 0.5, 0]));
    expect([...data]).toEqual([1, 2, 3, 255, 4, 5, 6, 100, 7, 8, 9, 0]);
    applyAlpha(data, null);
    expect(data[3]).toBe(255);
  });
});
