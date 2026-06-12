import { describe, it, expect } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { clutterDbForHeight, buildElevationSampler, buildClutterSampler } from './sources.js';

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

  it('degrades to null when no source is reachable (node has no WMS)', async () => {
    expect(await buildClutterSampler({ bounds: BOUNDS })).toBeNull();
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
