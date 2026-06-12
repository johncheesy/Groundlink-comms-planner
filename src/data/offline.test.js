import { describe, it, expect } from 'vitest';
import { PMTiles } from 'pmtiles';
import { tilesForBounds, manifestCovers, writePmtiles, BlobSource, MAX_PACK_TILES } from './offline.js';

// Synthetic 1°×1° test square on the null meridian — no real coordinates.
const BOUNDS = { west: 0, south: 0, east: 1, north: 1 };

describe('tilesForBounds', () => {
  it('enumerates every zoom while the budget allows, finer zooms = more tiles', () => {
    const tiles = tilesForBounds(BOUNDS, [8, 9, 10]);
    const byZoom = (z) => tiles.filter((t) => t.z === z).length;
    expect(byZoom(8)).toBeGreaterThan(0);
    expect(byZoom(9)).toBeGreaterThanOrEqual(byZoom(8));
    expect(byZoom(10)).toBeGreaterThanOrEqual(byZoom(9));
    expect(tiles.length).toBeLessThanOrEqual(MAX_PACK_TILES);
  });

  it('drops the highest zooms first when the budget is tight', () => {
    const all = tilesForBounds(BOUNDS, [8, 9, 10]);
    const capped = tilesForBounds(BOUNDS, [8, 9, 10], tilesForBounds(BOUNDS, [8, 9]).length);
    expect(capped.every((t) => t.z <= 9)).toBe(true);
    expect(capped.length).toBeLessThan(all.length);
  });
});

describe('manifestCovers', () => {
  const manifest = { bounds: BOUNDS };
  it('true only when the request fits inside the packaged extent', () => {
    expect(manifestCovers(manifest, { west: 0.2, south: 0.2, east: 0.8, north: 0.8 })).toBe(true);
    expect(manifestCovers(manifest, BOUNDS)).toBe(true);
    expect(manifestCovers(manifest, { west: -0.1, south: 0.2, east: 0.8, north: 0.8 })).toBe(false);
    expect(manifestCovers(manifest, { west: 0.2, south: 0.2, east: 1.2, north: 0.8 })).toBe(false);
    expect(manifestCovers(null, BOUNDS)).toBe(false);
    expect(manifestCovers({}, BOUNDS)).toBe(false);
  });
});

describe('writePmtiles ↔ pmtiles reader round-trip', () => {
  const payload = (n) => Uint8Array.from({ length: 8 + n }, (_, i) => (i * 7 + n) & 0xff);
  const tiles = [
    { z: 2, x: 1, y: 1, data: payload(1) },
    { z: 2, x: 2, y: 1, data: payload(2) },
    { z: 3, x: 4, y: 3, data: payload(3) },
  ];

  async function openWritten() {
    const buf = writePmtiles(tiles, { tileType: 2, minZoom: 2, maxZoom: 3, bounds: BOUNDS });
    return new PMTiles(new BlobSource(new Blob([buf]), 'test'));
  }

  it('the reference reader returns every tile byte-identical', async () => {
    const pm = await openWritten();
    for (const t of tiles) {
      const res = await pm.getZxy(t.z, t.x, t.y);
      expect(res?.data).toBeTruthy();
      expect(new Uint8Array(res.data)).toEqual(t.data);
    }
  });

  it('absent tiles read as undefined, not an error', async () => {
    const pm = await openWritten();
    expect(await pm.getZxy(2, 0, 0)).toBeUndefined();
    expect(await pm.getZxy(5, 9, 9)).toBeUndefined();
  });

  it('header carries zoom range and the e7 bounds', async () => {
    const pm = await openWritten();
    const h = await pm.getHeader();
    expect(h.minZoom).toBe(2);
    expect(h.maxZoom).toBe(3);
    expect(h.tileType).toBe(2); // png
    expect(h.maxLon).toBeCloseTo(1, 6);
    expect(h.maxLat).toBeCloseTo(1, 6);
  });

  it('rejects an empty tile list', () => {
    expect(() => writePmtiles([], {})).toThrow();
  });
});
