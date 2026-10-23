import { describe, it, expect, vi } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { clutterDbForHeight, blendClutter, buildElevationSampler, buildClutterSampler } from './sources.js';

/** Synthetic canopy-height GeoTIFF over a 0–4° square (no real coordinates). */
async function canopyBlob(values) {
  const buf = await writeArrayBuffer(new Float32Array(values), {
    width: 4,
    height: 4,
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, 0, 4, 0],
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2,
  });
  return new Blob([buf], { type: 'image/tiff' });
}

const BOUNDS = { west: 0, south: 0, east: 4, north: 4 };

describe('clutterDbForHeight', () => {
  it('anchors near the WorldCover class table', () => {
    expect(clutterDbForHeight(0)).toBe(0);
    expect(clutterDbForHeight(20)).toBeCloseTo(13.1, 1); // tree cover ~12 dB
    expect(clutterDbForHeight(4)).toBeCloseTo(6.9, 1); // shrubland ~6 dB
    expect(clutterDbForHeight(1000)).toBe(14); // capped at the table ceiling
  });

  it('is monotonic and never negative', () => {
    let prev = 0;
    for (const h of [0, 0.5, 1, 2, 5, 10, 25, 50]) {
      const db = clutterDbForHeight(h);
      expect(db).toBeGreaterThanOrEqual(prev);
      prev = db;
    }
    expect(clutterDbForHeight(-3)).toBe(0);
  });
});

describe('buildClutterSampler', () => {
  it('local COG heights feed both engine faces (heightM + dbAt)', async () => {
    const sampler = await buildClutterSampler({ bounds: BOUNDS, cog: await canopyBlob(Array(16).fill(20)) });
    expect(sampler).not.toBeNull();
    expect(sampler.id).toBe('cog');
    expect(sampler.heightM(2, 2)).toBe(20);
    expect(sampler.dbAt(2, 2)).toBeCloseTo(clutterDbForHeight(20), 9);
  });

  it('negative / nodata heights clamp to 0 (no negative clutter)', async () => {
    const sampler = await buildClutterSampler({ bounds: BOUNDS, cog: await canopyBlob(Array(16).fill(-5)) });
    expect(sampler.heightM(2, 2)).toBe(0);
    expect(sampler.dbAt(2, 2)).toBe(0);
  });

  it('rejects with the reason when the land-cover service is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    try {
      await expect(buildClutterSampler({ bounds: BOUNDS })).rejects.toMatchObject({ reason: 'network' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('buildElevationSampler', () => {
  it('a local COG works standalone when no tile source is reachable', async () => {
    // In node neither OPFS nor OffscreenCanvas exists → Terrarium path yields
    // null; the COG must still carry the sampler (0 outside its extent).
    const sampler = await buildElevationSampler({ bounds: BOUNDS, cog: await canopyBlob(Array(16).fill(123)) });
    expect(sampler).not.toBeNull();
    expect(sampler.id).toBe('cog');
    expect(sampler.sample(2, 2)).toBeCloseTo(123, 6);
    expect(sampler.sample(40, 40)).toBe(0); // outside the file, no fallback
  });

  it('degrades to null with no COG and no reachable tiles (flat-earth fallback)', async () => {
    expect(await buildElevationSampler({ bounds: BOUNDS })).toBeNull();
  });
});

describe('blendClutter', () => {
  it('forest takes the measured canopy height', () => {
    expect(blendClutter(10, 6).h).toBe(6);
    expect(blendClutter(10, 6).db).toBeCloseTo(clutterDbForHeight(6), 9);
  });

  it('other vegetation takes the taller of table and canopy', () => {
    expect(blendClutter(40, 12).h).toBe(12); // tree line in cropland
    expect(blendClutter(20, 1).h).toBe(4); // shrubland table beats 1 m
  });

  it('keeps the class table without canopy data or for built-up, bare and water', () => {
    expect(blendClutter(10, 0)).toEqual({ h: 20, db: 12 });
    expect(blendClutter(50, 15)).toEqual({ h: 8, db: 10 });
    expect(blendClutter(80, 9)).toEqual({ h: 0, db: 0 });
  });

  it('uses canopy alone when the land-cover class is unknown', () => {
    expect(blendClutter(0, 18).h).toBe(18);
    expect(blendClutter(0, 0)).toEqual({ h: 0, db: 0 });
  });
});
