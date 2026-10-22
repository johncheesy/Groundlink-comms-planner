import { describe, it, expect, vi } from 'vitest';
import {
  TERRAIN_PRIMARY, TERRAIN_FALLBACK, fetchTerrainTile, decodeTerrarium, createMosaicSampler,
  sourceSummary, terrainCredit, lon2tileX, lat2tileY,
} from './terrain-tiles.js';

const okRes = (tag) => ({ ok: true, blob: async () => tag });
const encode = (m) => { const v = m + 32768; const r = Math.floor(v / 256); const g = Math.floor(v - r * 256); const b = Math.round((v - r * 256 - g) * 256); return [r, g, b, 255]; };

describe('fetchTerrainTile', () => {
  it('uses Mapterhorn first within its zoom range', async () => {
    const f = vi.fn(async () => okRes('mt'));
    const r = await fetchTerrainTile(12, 2104, 1362, { fetchImpl: f });
    expect(r).toEqual({ blob: 'mt', source: 'mapterhorn' });
    expect(f.mock.calls[0][0]).toBe('https://tiles.mapterhorn.com/12/2104/1362.webp');
  });
  it('falls back to AWS per tile on an error status', async () => {
    const f = vi.fn(async (u) => (u.includes('mapterhorn') ? { ok: false, status: 503 } : okRes('aws')));
    expect(await fetchTerrainTile(10, 1, 2, { fetchImpl: f })).toEqual({ blob: 'aws', source: 'terrarium' });
    expect(f.mock.calls[1][0]).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/1/2.png');
  });
  it('falls back on a network failure', async () => {
    const f = vi.fn(async (u) => { if (u.includes('mapterhorn')) throw new TypeError('Failed to fetch'); return okRes('aws'); });
    expect((await fetchTerrainTile(9, 1, 1, { fetchImpl: f })).source).toBe('terrarium');
  });
  it('never asks Mapterhorn above zoom 12 (bare-earth LiDAR there)', async () => {
    const f = vi.fn(async () => okRes('aws'));
    await fetchTerrainTile(13, 1, 1, { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toMatch(/elevation-tiles-prod/);
    expect(TERRAIN_PRIMARY.maxzoom).toBe(12);
  });
  it('returns null when nobody has the tile', async () => {
    expect(await fetchTerrainTile(5, 1, 1, { fetchImpl: async () => ({ ok: false, status: 404 }) })).toBeNull();
  });
});

describe('decodeTerrarium', () => {
  it('round-trips heights including below sea level and fractions', () => {
    const heights = [0, 1.5, -432, 4441.5, 8848, -10994];
    const rgba = Uint8ClampedArray.from(heights.flatMap(encode));
    const out = decodeTerrarium(rgba);
    heights.forEach((h, i) => expect(out[i]).toBeCloseTo(h, 2));
  });
});

/** A tile whose height rises 1 m per pixel eastwards, in tile-global terms. */
function rampTile(tx, w) {
  const data = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) data[y * w + x] = (tx + (x + 0.5) / w) * 1000; // height = tile-units × 1000
  return { w, h: w, data };
}

describe('createMosaicSampler', () => {
  const z = 10;
  const lng = (t) => (t / 2 ** z) * 360 - 180; // tile x → longitude

  it('reads a single tile bilinearly', () => {
    const lat = 40;
    const ty = Math.floor(lat2tileY(lat, z));
    const tiles = new Map([[`500,${ty}`, rampTile(500, 256)]]);
    const s = createMosaicSampler({ z, tiles, range: { minX: 500, maxX: 500, minY: ty, maxY: ty } });
    const h = s.sample(lng(500.25), lat);
    expect(h).toBeGreaterThan(500.2 * 1000);
    expect(h).toBeLessThan(500.3 * 1000);
  });

  it('stays continuous across a seam between a 512 px and a 256 px tile', () => {
    // Terrarium RGB must not be scaled as an image; mixed sizes are read per tile.
    const lat = 10;
    const ty = Math.floor(lat2tileY(lat, z));
    const tiles = new Map([[`600,${ty}`, rampTile(600, 512)], [`601,${ty}`, rampTile(601, 256)]]);
    const s = createMosaicSampler({ z, tiles, range: { minX: 600, maxX: 601, minY: ty, maxY: ty } });
    const left = s.sample(lng(600.999), lat);
    const right = s.sample(lng(601.001), lat);
    expect(Math.abs(right - left)).toBeLessThan(6); // a few metres at most across the seam
    expect(left).toBeGreaterThan(600.98 * 1000);
    expect(right).toBeLessThan(601.02 * 1000);
  });

  it('reads 0 for a missing tile and clamps to the fetched range at the edges', () => {
    const lat = 20;
    const ty = Math.floor(lat2tileY(lat, z));
    const tiles = new Map([[`700,${ty}`, rampTile(700, 256)]]);
    const s = createMosaicSampler({ z, tiles, range: { minX: 700, maxX: 701, minY: ty, maxY: ty } });
    expect(s.sample(lng(701.5), lat)).toBe(0); // tile 701 missing (sea / outage)
    const westOfRange = s.sample(lng(699.5), lat); // outside: clamped to the first column
    expect(westOfRange).toBeGreaterThan(699.99 * 1000);
  });

  it('uses the tile maths shared with the rest of the app', () => {
    expect(lon2tileX(-180, 3)).toBe(0);
    expect(lon2tileX(180, 3)).toBe(8);
    expect(lat2tileY(0, 1)).toBeCloseTo(1, 9);
  });
});

describe('labels', () => {
  it('summarises the sources used, in a stable order', () => {
    expect(sourceSummary(['terrarium', 'mapterhorn', 'mapterhorn'])).toBe('mapterhorn+terrarium');
    expect(sourceSummary(['offline'])).toBe('offline');
    expect(sourceSummary([])).toBeNull();
  });
  it('credits the data in words', () => {
    expect(terrainCredit('mapterhorn')).toBe(TERRAIN_PRIMARY.credit);
    expect(terrainCredit('mapterhorn+terrarium')).toBe(`${TERRAIN_PRIMARY.credit} + ${TERRAIN_FALLBACK.credit}`);
    expect(terrainCredit(null)).toBeNull();
  });
});
