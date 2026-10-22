import { describe, it, expect } from 'vitest';
import { quadkey, mercX, mercY, chmTileRange, pickLevel } from './canopy.js';

describe('quadkey', () => {
  it('matches the Bing tile-system examples', () => {
    expect(quadkey(3, 5, 3)).toBe('213');
    expect(quadkey(0, 0, 1)).toBe('0');
    expect(quadkey(1, 1, 1)).toBe('3');
  });

  it('gives a 10-character key at zoom 10', () => {
    expect(quadkey(512, 340)).toHaveLength(10);
  });
});

describe('mercator', () => {
  it('maps the origin and the world edge', () => {
    expect(mercX(0)).toBe(0);
    expect(mercY(0)).toBeCloseTo(0, 9);
    expect(mercX(180)).toBeCloseTo(20037508.34, 1);
  });

  it('clamps the poles instead of returning Infinity', () => {
    expect(Number.isFinite(mercY(90))).toBe(true);
  });
});

describe('chmTileRange', () => {
  it('covers a small bbox with one tile', () => {
    const r = chmTileRange({ west: 0.01, south: 0.01, east: 0.02, north: 0.02 });
    expect(r.count).toBe(1);
    expect(r.minX).toBe(512);
    expect(r.minY).toBe(511); // just north of the equator
  });

  it('grows with the bbox and keeps north at the smaller y', () => {
    const r = chmTileRange({ west: -0.5, south: -0.5, east: 0.5, north: 0.5 });
    expect(r.maxX - r.minX + 1).toBe(4);
    expect(r.minY).toBeLessThan(r.maxY);
  });

  it('does not add a column for a bbox ending exactly on a tile edge', () => {
    const edge = 360 / 1024;
    expect(chmTileRange({ west: 0, south: 0.01, east: edge, north: 0.02 }).count).toBe(1);
  });
});

describe('pickLevel', () => {
  const widths = [32768, 16384, 8192, 4096, 2048, 1024, 512];
  const span = 39135.76; // one zoom-10 tile in mercator metres

  it('picks the coarsest level that is still fine enough', () => {
    expect(widths[pickLevel(widths, span, 40)]).toBe(1024); // ~38 m pixels
    expect(widths[pickLevel(widths, span, 100)]).toBe(512); // coarsest is 76 m
    expect(widths[pickLevel(widths, span, 10)]).toBe(4096); // ~9.6 m
  });

  it('falls back to the finest level when nothing is fine enough', () => {
    expect(widths[pickLevel(widths, span, 0.5)]).toBe(32768);
  });
});
