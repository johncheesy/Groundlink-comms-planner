import { describe, it, expect } from 'vitest';
import { describeAssumptions, cellSizeM, COARSE_CELL_M } from './assumptions.js';

const base = { freqMHz: 450, powerW: 2, txHeightM: 8, rxHeightM: 1.5, terrainUsed: true, clutterRequested: true, clutterUsed: true, cellM: 136, radioApplied: true };

describe('cellSizeM', () => {
  it('converts bounds and column count to metres at the mid latitude', () => {
    const m = cellSizeM({ west: 0, east: 1, south: -0.5, north: 0.5 }, 100);
    expect(m).toBeCloseTo(1113.2, 0); // 1° at the equator / 100 cols
  });
  it('shrinks east-west with latitude', () => {
    const eq = cellSizeM({ west: 0, east: 1, south: 0, north: 0 }, 100);
    const hi = cellSizeM({ west: 0, east: 1, south: 60, north: 60 }, 100);
    expect(hi).toBeCloseTo(eq / 2, 0);
  });
  it('returns null for unusable input', () => {
    expect(cellSizeM(null, 10)).toBeNull();
    expect(cellSizeM({ west: 0, east: 1, south: 0, north: 0 }, 0)).toBeNull();
  });
});

describe('describeAssumptions', () => {
  it('states the numbers used', () => {
    const r = describeAssumptions(base);
    expect(r.summary).toBe('450 MHz · 2 W · tx 8 m · rx 1.5 m · cell ≈ 136 m');
    expect(r.source).toBe('radio');
    expect(r.warnings).toEqual([]);
  });
  it('flags default radio values when nothing was chosen', () => {
    const r = describeAssumptions({ ...base, radioApplied: false, freqMHz: 150, powerW: 5 });
    expect(r.source).toBe('defaults');
    expect(r.warnings[0]).toMatch(/No radio selected/);
  });
  it('typed values without a radio are "manual", not defaults', () => {
    const r = describeAssumptions({ ...base, radioApplied: false });
    expect(r.source).toBe('manual');
    expect(r.warnings.some((w) => /No radio selected/.test(w))).toBe(false);
  });
  it('warns when clutter is off, and when it was requested but unavailable', () => {
    expect(describeAssumptions({ ...base, clutterRequested: false, clutterUsed: false }).warnings.join(' ')).toMatch(/Clutter is off/);
    expect(describeAssumptions({ ...base, clutterUsed: false }).warnings.join(' ')).toMatch(/no data was available/);
  });
  it('warns about flat earth', () => {
    expect(describeAssumptions({ ...base, terrainUsed: false }).warnings.join(' ')).toMatch(/Flat earth/);
  });
  it('warns when the grid is coarse, with the cell size', () => {
    const r = describeAssumptions({ ...base, cellM: COARSE_CELL_M + 1 });
    expect(r.warnings.join(' ')).toMatch(/Coarse grid/);
    expect(describeAssumptions({ ...base, cellM: 1400 }).summary).toMatch(/cell ≈ 1\.4 km/);
  });
  it('omits the cell when unknown', () => {
    expect(describeAssumptions({ ...base, cellM: null }).summary).not.toMatch(/cell/);
  });
});
