import { describe, it, expect } from 'vitest';
import { pickZoom, pickLidarZoom } from './dem.js';

describe('pickLidarZoom', () => {
  it('is null where pickZoom already sits at or below the GLO-30 cap', () => {
    expect(pickLidarZoom({ west: 0, south: 0, east: 0.5, north: 0.5 })).toBeNull();
    expect(pickZoom({ west: 0, south: 0, east: 0.5, north: 0.5 })).toBeLessThanOrEqual(12);
  });

  it('goes above 12 for small areas and caps at 14', () => {
    expect(pickLidarZoom({ west: 0, south: 0, east: 0.08, north: 0.08 })).toBe(13);
    expect(pickLidarZoom({ west: 0, south: 0, east: 0.001, north: 0.001 })).toBe(14);
  });
});
