import { describe, it, expect, vi } from 'vitest';
import { buildBuildingHeights, MAX_BUILDING_M } from './buildings.js';

vi.mock('./cog.js', () => ({
  buildCogSampler: vi.fn(async (url) => (url === 'down' ? null : { sample: (lng) => [0, 7.5, 140, -3][lng] })),
}));

describe('buildBuildingHeights', () => {
  it('passes block heights through, capped, and treats no-data as no buildings', async () => {
    const b = await buildBuildingHeights({ west: 0, south: 0, east: 1, north: 1 }, { url: 'ok' });
    expect(b.id).toBe('ghsl');
    expect(b.heightM(0, 0)).toBe(0);
    expect(b.heightM(1, 0)).toBe(7.5);
    expect(b.heightM(2, 0)).toBe(MAX_BUILDING_M);
    expect(b.heightM(3, 0)).toBe(0);
  });

  it('returns null when the source is unreachable', async () => {
    expect(await buildBuildingHeights({ west: 0, south: 0, east: 1, north: 1 }, { url: 'down' })).toBeNull();
  });
});
