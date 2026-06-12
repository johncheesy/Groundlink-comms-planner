import { describe, it, expect, vi } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { createLru, pickOverview, windowFor, makeGridSampler, buildCogSampler, resetCogCaches } from './cog.js';

/** Synthetic 4×4 geographic GeoTIFF over a 0–4° test square (no real coords). */
async function syntheticTiffBlob(values = [...Array(16).keys()]) {
  const buf = await writeArrayBuffer(new Float32Array(values), {
    width: 4,
    height: 4,
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, 0, 4, 0], // top-left pixel ↦ (0°E, 4°N)
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2,
  });
  return new Blob([buf], { type: 'image/tiff' });
}

describe('createLru', () => {
  it('evicts the least-recently-used entry', () => {
    const lru = createLru(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a'); // refresh a
    lru.set('c', 3); // evicts b
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('c')).toBe(true);
    expect(lru.size()).toBe(2);
  });
});

describe('pickOverview', () => {
  const levels = [
    { width: 4096, height: 4096 },
    { width: 2048, height: 2048 },
    { width: 1024, height: 1024 },
    { width: 512, height: 512 },
  ];
  const dataBbox = [0, 0, 4, 4];

  it('full-extent request takes the smallest level that still hits maxDim', () => {
    expect(pickOverview(levels, { west: 0, south: 0, east: 4, north: 4 }, dataBbox, 512)).toBe(3);
  });

  it('small windows climb to finer levels', () => {
    expect(pickOverview(levels, { west: 0, south: 0, east: 1, north: 1 }, dataBbox, 512)).toBe(1);
  });

  it('falls back to full resolution when nothing satisfies', () => {
    expect(pickOverview(levels, { west: 0, south: 0, east: 0.01, north: 0.01 }, dataBbox, 512)).toBe(0);
  });
});

describe('windowFor', () => {
  it('maps a bbox to the right pixel window (north-up)', () => {
    expect(windowFor({ west: 1, south: 1, east: 2, north: 2 }, [0, 0, 4, 4], 400, 400)).toEqual([100, 200, 200, 300]);
  });

  it('clamps to the raster and never collapses to zero pixels', () => {
    const [x0, y0, x1, y1] = windowFor({ west: -10, south: -10, east: -9, north: -9 }, [0, 0, 4, 4], 400, 400);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(400);
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });
});

describe('makeGridSampler', () => {
  const grid = {
    data: [10, 20, 30, 40], // row 0 = north
    width: 2,
    height: 2,
    bbox: { west: 0, south: 0, east: 2, north: 2 },
  };

  it('bilinear at the centre averages all four pixels', () => {
    expect(makeGridSampler(grid).sample(1, 1)).toBeCloseTo(25, 9);
  });

  it('nearest mode returns discrete values', () => {
    const s = makeGridSampler(grid, { interpolate: false });
    expect(s.sample(0.5, 1.5)).toBe(10);
    expect(s.sample(1.5, 0.5)).toBe(40);
  });

  it('outside the window returns the neutral value', () => {
    const s = makeGridSampler(grid, { neutral: -1 });
    expect(s.sample(10, 1)).toBe(-1);
    expect(s.sample(1, -10)).toBe(-1);
  });

  it('noData pixels fall back to neutral (nearest) / present-corner mean (bilinear)', () => {
    const g2 = { ...grid, data: [10, -9999, 30, 40] };
    const nearest = makeGridSampler(g2, { neutral: 0, noData: -9999, interpolate: false });
    expect(nearest.sample(1.5, 1.5)).toBe(0);
    // Missing corner replaced by the mean of present ones (80/3), then the
    // centre bilinear is the plain average: (10 + 80/3 + 30 + 40)/4 = 26.67.
    const bilin = makeGridSampler(g2, { neutral: 0, noData: -9999 });
    expect(bilin.sample(1, 1)).toBeCloseTo(26.67, 1);
  });
});

describe('buildCogSampler (end-to-end on a synthetic GeoTIFF)', () => {
  it('samples pixel values from a local Blob — no network, no CORS', async () => {
    resetCogCaches();
    // Values 0..15 over 0–4°: pixel (col 2, row 1 from north) = 6.
    const blob = await syntheticTiffBlob();
    const sampler = await buildCogSampler(blob, { west: 0, south: 0, east: 4, north: 4 }, { interpolate: false });
    expect(sampler).not.toBeNull();
    expect(sampler.sample(2.5, 2.5)).toBe(6);
    expect(sampler.sample(0.5, 3.5)).toBe(0);
    expect(sampler.sample(3.5, 0.5)).toBe(15);
  });

  it('returns the neutral value outside the file extent', async () => {
    resetCogCaches();
    const blob = await syntheticTiffBlob();
    const sampler = await buildCogSampler(blob, { west: 0, south: 0, east: 6, north: 6 }, { neutral: NaN, interpolate: false });
    expect(Number.isNaN(sampler.sample(5.5, 5.5))).toBe(true);
    expect(sampler.sample(2.5, 2.5)).toBe(6);
  });

  it('a broken source degrades to null with a single warning, never a throw', async () => {
    resetCogCaches();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const junk = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const a = await buildCogSampler(junk, { west: 0, south: 0, east: 1, north: 1 });
    const b = await buildCogSampler(junk, { west: 0, south: 0, east: 1, north: 1 });
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1); // logged once, then remembered
    warn.mockRestore();
  });
});
