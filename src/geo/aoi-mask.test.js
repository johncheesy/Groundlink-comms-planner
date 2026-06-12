import { describe, it, expect } from 'vitest';
import { inAoi, pointInRing, demandGrid, padBounds, diagonalM, bboxOfPoints } from './aoi-mask.js';

// All fixtures use abstract equator coordinates — no real locations.
const UNIT_RING = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe('pointInRing', () => {
  it('classifies inside vs outside a unit square', () => {
    expect(pointInRing(UNIT_RING, 0.5, 0.5)).toBe(true);
    expect(pointInRing(UNIT_RING, 1.5, 0.5)).toBe(false);
    expect(pointInRing(UNIT_RING, -0.1, 0.5)).toBe(false);
  });

  it('handles a concave ring', () => {
    // L-shape: the notch at the top-right is outside.
    const ell = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(pointInRing(ell, 0.5, 1.5)).toBe(true);
    expect(pointInRing(ell, 1.5, 1.5)).toBe(false);
  });
});

describe('inAoi', () => {
  it('no AOI means everything is in scope', () => {
    expect(inAoi(null, 12, 34)).toBe(true);
  });

  it('radius AOI uses great-circle distance', () => {
    const aoi = { type: 'radius', center: { lat: 0, lng: 0 }, radiusM: 150000 };
    expect(inAoi(aoi, 1, 0)).toBe(true); // ~111 km
    expect(inAoi(aoi, 2, 0)).toBe(false); // ~222 km
  });

  it('polygon AOI delegates to the ring test', () => {
    const aoi = { type: 'polygon', ring: UNIT_RING };
    expect(inAoi(aoi, 0.5, 0.5)).toBe(true);
    expect(inAoi(aoi, 3, 3)).toBe(false);
  });
});

describe('demandGrid', () => {
  const bounds = { west: 0, south: 0, east: 1, north: 1 };

  it('fills the bbox when there is no AOI mask', () => {
    const pts = demandGrid(bounds, null, 10);
    expect(pts.length).toBe(100); // square bbox → maxDim × maxDim
    for (const p of pts) {
      expect(p.lng).toBeGreaterThan(0);
      expect(p.lng).toBeLessThan(1);
      expect(p.lat).toBeGreaterThan(0);
      expect(p.lat).toBeLessThan(1);
    }
  });

  it('masks points to the AOI shape', () => {
    const aoi = { type: 'radius', center: { lat: 0.5, lng: 0.5 }, radiusM: 30000 };
    const pts = demandGrid(bounds, aoi, 10);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length).toBeLessThan(100);
    for (const p of pts) expect(inAoi(aoi, p.lng, p.lat)).toBe(true);
  });

  it('keeps at least 4 rows on extreme aspect ratios', () => {
    const wide = { west: 0, south: 0, east: 10, north: 0.1 };
    const pts = demandGrid(wide, null, 20);
    const lats = new Set(pts.map((p) => p.lat));
    expect(lats.size).toBeGreaterThanOrEqual(4);
  });
});

describe('bbox helpers', () => {
  it('padBounds expands each side by the fraction', () => {
    const b = padBounds({ west: 0, south: 0, east: 1, north: 2 }, 0.1);
    expect(b.west).toBeCloseTo(-0.1, 9);
    expect(b.east).toBeCloseTo(1.1, 9);
    expect(b.south).toBeCloseTo(-0.2, 9);
    expect(b.north).toBeCloseTo(2.2, 9);
  });

  it('diagonalM measures the corner-to-corner distance', () => {
    const d = diagonalM({ west: 0, south: 0, east: 1, north: 0 });
    expect(d).toBeCloseTo(111195, -1);
  });

  it('bboxOfPoints wraps the point set and is null when empty', () => {
    expect(bboxOfPoints([])).toBeNull();
    const b = bboxOfPoints([{ lat: 1, lng: 2 }, { lat: -1, lng: 5 }]);
    expect(b).toEqual({ west: 2, south: -1, east: 5, north: 1 });
  });
});
