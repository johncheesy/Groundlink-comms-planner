import { describe, it, expect } from 'vitest';
import { gridDims, sizeKm, ringBounds, DETAIL, MIN_BUDGET } from './grid.js';

// A square window of `km` around 52°N, and an AOI of `aoiKm` in its middle.
const box = (km, lat = 52, lng = 5) => {
  const dLat = km / 2 / 111.32;
  const dLng = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, east: lng + dLng, south: lat - dLat, north: lat + dLat };
};
const oldDims = (b) => { const s = sizeKm(b); return s.w >= s.h ? 220 : 220; };

describe('gridDims', () => {
  it('without an AOI it behaves like the old grid (220 across the window)', () => {
    const g = gridDims(box(60));
    expect(Math.max(g.cols, g.rows)).toBe(220);
  });
  it('the old problem: an AOI in a 3x larger window got only ~73 cells across; now well over 100, and 200+ on High', () => {
    const old = 20 / (60 / 220); // ≈ 73 cells across a 20 km AOI in a 60 km window
    const std = gridDims(box(60), { aoiBounds: box(20) });
    const high = gridDims(box(60), { aoiBounds: box(20), detail: 'high' });
    expect(20 / std.cellKm).toBeGreaterThan(old * 1.6);
    expect(20 / high.cellKm).toBeGreaterThan(200);
  });
  it('more transmitters shrink the budget, but never below the old 220 x 220 grid', () => {
    const one = gridDims(box(60), { aoiBounds: box(20), txCount: 1 });
    const ten = gridDims(box(60), { aoiBounds: box(20), txCount: 10 });
    const many = gridDims(box(60), { aoiBounds: box(20), txCount: 120 });
    expect(ten.cols * ten.rows).toBeLessThan(one.cols * one.rows);
    expect(many.budget).toBe(MIN_BUDGET);
    expect(many.cols * many.rows).toBeGreaterThanOrEqual(MIN_BUDGET - 2 * 220);
    expect(gridDims(box(60), { txCount: 3 }).budget).toBe(DETAIL.standard.budget);
  });
  it('respects the cell budget and says when it had to coarsen', () => {
    const g = gridDims(box(120), { aoiBounds: box(10) }); // would need 2640x2640
    expect(g.cols * g.rows).toBeLessThanOrEqual(DETAIL.standard.budget);
    expect(g.capped).toBe(true);
  });
  it('is never coarser than the old rule', () => {
    for (const [win, aoi] of [[10, 10], [60, 20], [200, 150], [400, 5]]) {
      const g = gridDims(box(win), { aoiBounds: box(aoi) });
      expect(Math.max(g.cols, g.rows)).toBeGreaterThanOrEqual(220 - 1);
      expect(oldDims(box(win))).toBe(220);
    }
  });
  it('high detail is finer than standard and has a larger budget', () => {
    const s = gridDims(box(60), { aoiBounds: box(20) });
    const h = gridDims(box(60), { aoiBounds: box(20), detail: 'high' });
    expect(h.cellKm).toBeLessThan(s.cellKm);
    expect(h.cols * h.rows).toBeLessThanOrEqual(DETAIL.high.budget);
  });
  it('keeps the window aspect ratio', () => {
    const b = { ...box(60), east: box(60).east + (box(60).east - box(60).west) }; // twice as wide
    const g = gridDims(b);
    expect(g.cols / g.rows).toBeCloseTo(2, 1);
  });
  it('unknown detail falls back to standard; tiny windows keep a minimum size', () => {
    expect(gridDims(box(60), { detail: 'nope' })).toEqual(gridDims(box(60)));
    const tiny = gridDims(box(0.001));
    expect(tiny.cols).toBeGreaterThanOrEqual(8);
    expect(tiny.rows).toBeGreaterThanOrEqual(8);
  });
});

describe('ringBounds', () => {
  it('bounds a ring and skips junk', () => {
    expect(ringBounds([[4, 52], [5, 52], [5, 53], ['x', 1]])).toEqual({ west: 4, east: 5, south: 52, north: 53 });
    expect(ringBounds(null)).toBeNull();
    expect(ringBounds([[1, 1]])).toBeNull();
  });
});
