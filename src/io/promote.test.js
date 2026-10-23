import { describe, it, expect } from 'vitest';
import { linksFromLines, polygonChoices } from './promote.js';

const sites = [
  { id: 's1', name: 'A', lat: -8.93, lng: 27.20 },
  { id: 's2', name: 'B', lat: -8.90, lng: 27.16 },
  { id: 's3', name: 'C', lat: -8.86, lng: 27.07 },
];
const line = (name, coords) => ({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: coords } });

describe('linksFromLines', () => {
  it('turns tower-to-tower lines into site pairs, tolerating small offsets and altitudes', () => {
    const fs = [
      line('A - B', [[27.2001, -8.9301, 1850], [27.16, -8.90, 1861]]),
      line('B - C', [[27.16, -8.90], [27.0702, -8.8601]]),
    ];
    expect(linksFromLines(fs, sites)).toEqual([
      { a: 's1', b: 's2', label: 'A - B', featureIndex: 0 },
      { a: 's2', b: 's3', label: 'B - C', featureIndex: 1 },
    ]);
  });
  it('skips tracks that do not end on two sites, self-loops and duplicate pairs', () => {
    const fs = [
      line('track', [[27.20, -8.93], [26.5, -9.4]]), // second end on no site
      line('loop', [[27.16, -8.90], [27.1601, -8.9001]]), // both ends on B
      line('A-B', [[27.20, -8.93], [27.16, -8.90]]),
      line('B-A again', [[27.16, -8.90], [27.20, -8.93]]),
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [27.2, -8.93] } },
    ];
    const out = linksFromLines(fs, sites);
    expect(out.map((l) => l.label)).toEqual(['A-B']);
  });
  it('respects the snap distance', () => {
    const fs = [line('far', [[27.21, -8.93], [27.16, -8.90]])]; // ~1.1 km off A
    expect(linksFromLines(fs, sites)).toEqual([]);
    expect(linksFromLines(fs, sites, 2000)).toHaveLength(1);
  });
});

describe('polygonChoices', () => {
  it('names each polygon with its vertex count', () => {
    const ring = (n) => [...Array(n).keys()].map((i) => [i, i]).concat([[0, 0]]);
    const fs = [
      { type: 'Feature', properties: { name: 'Park' }, geometry: { type: 'Polygon', coordinates: [ring(463)] } },
      line('x', [[0, 0], [1, 1]]),
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(29)] } },
    ];
    expect(polygonChoices(fs)).toEqual([
      { featureIndex: 0, name: 'Park', vertices: 463 },
      { featureIndex: 2, name: 'Polygon 2', vertices: 29 },
    ]);
  });
});
