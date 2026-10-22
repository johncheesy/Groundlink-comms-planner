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

describe('updateAntennaBeams before the style is ready', () => {
  it('queues the newest update and draws it on the next idle', async () => {
    const { updateAntennaBeams } = await import('./antenna-beams.js');
    globalThis.document ??= { documentElement: {}, createElement: () => ({ getContext: () => ({ beginPath() {}, moveTo() {}, arc() {}, closePath() {}, fill() {}, stroke() {}, lineTo() {}, getImageData: () => ({}) }) }) };
    globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
    let ready = false;
    const idle = [];
    const sources = {};
    const map = {
      getSource: (id) => sources[id],
      hasImage: () => true,
      addImage() {},
      addSource(id, spec) {
        if (!ready) throw new Error('Style is not done loading');
        sources[id] = { data: spec.data, setData(d) { this.data = d; } };
      },
      addLayer() {},
      once(ev, fn) { if (ev === 'idle') idle.push(fn); },
    };
    updateAntennaBeams(map, sites, { ...yagi, azimuthDeg: 10 });
    updateAntennaBeams(map, sites, { ...yagi, azimuthDeg: 20 }); // newer, same idle
    expect(idle).toHaveLength(1);
    ready = true;
    idle[0]();
    expect(sources['gl-antenna-beams'].data.features[0].properties.az).toBe(20);
  });
});
