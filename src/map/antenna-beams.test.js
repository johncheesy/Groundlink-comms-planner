import { describe, it, expect } from 'vitest';
import { beamFeatures } from './antenna-beams.js';

const yagi = { gainDbi: 10, beamwidthDeg: 50, fbDb: 20, azimuthDeg: 45 };
const sites = [{ lat: 0.1, lng: 0.2 }, { lat: 0.3, lng: 0.4, azimuthDeg: 180 }];

describe('beamFeatures', () => {
  it('draws nothing for an omni antenna', () => {
    expect(beamFeatures(sites, { ...yagi, beamwidthDeg: 360 }).features).toHaveLength(0);
  });

  it('one wedge per site: own pointing first, else the panel pointing', () => {
    const f = beamFeatures(sites, yagi).features;
    expect(f.map((x) => x.properties.az)).toEqual([45, 180]);
    expect(f.map((x) => x.properties.own)).toEqual([false, true]);
    expect(f[0].properties.bw).toBe(50);
    expect(f[1].geometry.coordinates).toEqual([0.4, 0.3]);
  });
});
