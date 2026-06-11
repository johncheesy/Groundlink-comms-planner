import { describe, it, expect } from 'vitest';
import { summarizeCoverage } from './summary.js';

/**
 * summarizeCoverage({ classes, cols, rows, bounds, aoi, thresholds }) — M20 §3.
 * Pure: from the painted class grid (row 0 = north, col 0 = west; classes
 * 0–4, 255 = transparent/below-floor) + the AOI shape, compute
 *   { coveredPct, deadZones: [{ centroid:{lng,lat}, areaKm2, cells }],
 *     weakestDbm, weakestBelow }
 * Covered = class ≤ 2 (excellent/good/marginal — same rule as the painter).
 * Dead zones = 8-connected components of non-covered in-AOI cells, ranked by
 * area, top 5. All coordinates synthetic (equatorial test square — no real
 * locations).
 */

const THRESHOLDS = { excellent: -85, good: -95, marginal: -103, none: -110 };

// 4×4 synthetic square: 0.04° on a side at the equator (~4.45 km).
const BOUNDS = { west: 0, south: 0, east: 0.04, north: 0.04 };

/** Build a classes grid from rows of digits ('t' = transparent 255). */
function grid(rowsStr) {
  const rows = rowsStr.length;
  const cols = rowsStr[0].length;
  const classes = new Uint8Array(rows * cols);
  rowsStr.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      classes[r * cols + c] = ch === 't' ? 255 : Number(ch);
    });
  });
  return { classes, cols, rows };
}

const summarize = (g, extra = {}) =>
  summarizeCoverage({ ...g, bounds: BOUNDS, aoi: null, thresholds: THRESHOLDS, ...extra });

describe('summarizeCoverage — covered percentage', () => {
  it('all excellent → 100 %, no dead zones', () => {
    const s = summarize(grid(['0000', '0000', '0000', '0000']));
    expect(s.coveredPct).toBe(100);
    expect(s.deadZones).toEqual([]);
  });

  it('marginal still counts as covered; poor/none/transparent do not', () => {
    const s = summarize(grid(['0122', '2222', '3444', 'tttt']));
    // 8 covered (≤2) of 16
    expect(s.coveredPct).toBe(50);
  });
});

describe('summarizeCoverage — dead zones (8-neighbour flood fill)', () => {
  it('finds one component for a 2×2 dead block and places its centroid', () => {
    const s = summarize(grid(['4400', '4400', '0000', '0000']));
    expect(s.deadZones).toHaveLength(1);
    const z = s.deadZones[0];
    expect(z.cells).toBe(4);
    // block occupies rows 0–1 (north half), cols 0–1 (west half)
    expect(z.centroid.lng).toBeCloseTo(0.01, 6);
    expect(z.centroid.lat).toBeCloseTo(0.03, 6);
    // 4 cells of ~0.01° × 0.01° at the equator ≈ 4 × 1.24 km²
    expect(z.areaKm2).toBeGreaterThan(3.5);
    expect(z.areaKm2).toBeLessThan(6.5);
  });

  it('separates non-touching components and ranks them by area', () => {
    const s = summarize(grid(['4400', '4400', '0000', '0004']));
    expect(s.deadZones).toHaveLength(2);
    expect(s.deadZones[0].cells).toBe(4); // biggest first
    expect(s.deadZones[1].cells).toBe(1);
  });

  it('merges diagonally-touching cells (8-connectivity)', () => {
    const s = summarize(grid(['4000', '0400', '0040', '0004']));
    expect(s.deadZones).toHaveLength(1);
    expect(s.deadZones[0].cells).toBe(4);
  });

  it('caps the list at the five largest zones', () => {
    // eight isolated single-cell dead zones on a 5×5 grid
    const g = grid(['40404', '00000', '40404', '00000', '40400']);
    const s = summarizeCoverage({ ...g, bounds: BOUNDS, aoi: null, thresholds: THRESHOLDS });
    expect(s.deadZones).toHaveLength(5);
  });

  it('treats transparent (below-floor) cells inside the AOI as dead', () => {
    const s = summarize(grid(['t000', '0000', '0000', '0000']));
    expect(s.deadZones).toHaveLength(1);
    expect(s.coveredPct).toBeCloseTo((15 / 16) * 100, 5);
  });
});

describe('summarizeCoverage — AOI clipping', () => {
  // polygon over the west half of the square
  const westHalf = {
    type: 'polygon',
    ring: [[0, 0], [0.02, 0], [0.02, 0.04], [0, 0.04], [0, 0]],
  };

  it('ignores cells outside the AOI for both pct and zones', () => {
    // dead cells only in the east half → fully covered inside the AOI
    const s = summarize(grid(['0044', '0044', '0044', '0044']), { aoi: westHalf });
    expect(s.coveredPct).toBe(100);
    expect(s.deadZones).toEqual([]);
  });

  it('counts the pct over in-AOI cells only', () => {
    // west half: top row dead (2 of 8 in-AOI cells)
    const s = summarize(grid(['4400', '0000', '0000', '0000']), { aoi: westHalf });
    expect(s.coveredPct).toBe(75);
    expect(s.deadZones).toHaveLength(1);
  });

  it('supports a radius AOI', () => {
    const aoi = { type: 'radius', center: { lat: 0.02, lng: 0.02 }, radiusM: 1200 };
    const s = summarize(grid(['4444', '4004', '4004', '4444']), { aoi });
    // only the central 2×2 falls within ~1.2 km of the centre — all covered
    expect(s.coveredPct).toBe(100);
    expect(s.deadZones).toEqual([]);
  });
});

describe('summarizeCoverage — weakest link', () => {
  it('reports the lower bound of the worst class present in the AOI', () => {
    const s = summarize(grid(['0000', '0000', '0011', '0012']));
    expect(s.weakestDbm).toBe(THRESHOLDS.marginal);
    expect(s.weakestBelow).toBe(false);
  });

  it('flags weakestBelow when any in-AOI cell is class 4 / transparent', () => {
    const s = summarize(grid(['0000', '0000', '0000', '000t']));
    expect(s.weakestDbm).toBe(THRESHOLDS.none);
    expect(s.weakestBelow).toBe(true);
  });

  it('all-excellent grid reports the excellent bound', () => {
    const s = summarize(grid(['00', '00']));
    expect(s.weakestDbm).toBe(THRESHOLDS.excellent);
    expect(s.weakestBelow).toBe(false);
  });
});
