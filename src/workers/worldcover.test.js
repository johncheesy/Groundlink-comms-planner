import { describe, it, expect } from 'vitest';
import { worldcoverItemId, worldcoverTiles, rasterSize, landcoverReasonText } from './worldcover.js';

describe('worldcoverItemId', () => {
  it('names the 3° tile by its south-west corner, zero-padded', () => {
    expect(worldcoverItemId(51, 3)).toBe('ESA_WorldCover_10m_2021_v200_N51E003');
    expect(worldcoverItemId(-3, 36)).toBe('ESA_WorldCover_10m_2021_v200_S03E036');
    expect(worldcoverItemId(39, -75)).toBe('ESA_WorldCover_10m_2021_v200_N39W075');
    expect(worldcoverItemId(0, -3)).toBe('ESA_WorldCover_10m_2021_v200_N00W003');
  });
});

describe('worldcoverTiles', () => {
  it('returns one tile when the bbox sits inside it', () => {
    const t = worldcoverTiles({ west: 1.2, south: 10.1, east: 1.8, north: 10.6 });
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe('ESA_WorldCover_10m_2021_v200_N09E000');
    expect(t[0]).toMatchObject({ west: 1.2, south: 10.1, east: 1.8, north: 10.6 });
  });

  it('splits a bbox across tile edges and clips each part', () => {
    const t = worldcoverTiles({ west: 2.5, south: 11.5, east: 3.5, north: 12.5 });
    expect(t.map((x) => x.id).sort()).toEqual([
      'ESA_WorldCover_10m_2021_v200_N09E000',
      'ESA_WorldCover_10m_2021_v200_N09E003',
      'ESA_WorldCover_10m_2021_v200_N12E000',
      'ESA_WorldCover_10m_2021_v200_N12E003',
    ]);
    const ne = t.find((x) => x.id.endsWith('N12E003'));
    expect(ne).toMatchObject({ west: 3, south: 12, east: 3.5, north: 12.5 });
  });

  it('handles the southern and western hemispheres', () => {
    const t = worldcoverTiles({ west: -0.5, south: -0.5, east: 0.5, north: 0.5 });
    expect(t.map((x) => x.id).sort()).toEqual([
      'ESA_WorldCover_10m_2021_v200_N00E000',
      'ESA_WorldCover_10m_2021_v200_N00W003',
      'ESA_WorldCover_10m_2021_v200_S03E000',
      'ESA_WorldCover_10m_2021_v200_S03W003',
    ]);
  });

  it('does not emit a zero-width part for a bbox ending on a tile edge', () => {
    const t = worldcoverTiles({ west: 1, south: 1, east: 3, north: 3 });
    expect(t).toHaveLength(1);
  });
});

describe('rasterSize', () => {
  it('gives the longer ground side the full size', () => {
    expect(rasterSize({ west: 0, south: 0, east: 1, north: 0.5 }, 1000)).toEqual({ W: 1000, H: 500 });
    expect(rasterSize({ west: 0, south: 0, east: 0.5, north: 1 }, 1000).H).toBe(1000);
  });

  it('corrects longitude for latitude so pixels stay square on the ground', () => {
    // At 60° a degree of longitude is half a degree of latitude on the ground.
    const { W, H } = rasterSize({ west: 0, south: 59.5, east: 2, north: 60.5 }, 1000);
    expect(W).toBe(1000);
    expect(H).toBeGreaterThan(980);
  });

  it('never collapses below 16 px', () => {
    expect(rasterSize({ west: 0, south: 0, east: 1, north: 0.0001 }, 1000).H).toBe(16);
  });
});

describe('landcoverReasonText', () => {
  it('explains every failure reason, with a generic fallback', () => {
    for (const r of ['timeout', 'network', 'http', 'decode']) {
      expect(landcoverReasonText(r)).toMatch(/land-cover/);
    }
    expect(landcoverReasonText(undefined)).toMatch(/unavailable/);
  });
});
