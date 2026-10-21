import { describe, it, expect } from 'vitest';
import { cleanGeometry, cleanFeatures } from './geometry-clean.js';

const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

describe('cleanGeometry', () => {
  it('keeps valid geometry untouched', () => {
    for (const g of [
      { type: 'Point', coordinates: [4.9, 52.3] },
      { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      { type: 'Polygon', coordinates: [sq] },
    ]) expect(cleanGeometry(g)).toEqual(g);
  });
  it('drops points with bad positions', () => {
    for (const c of [[4.9, 95], [200, 10], ['a', null], [NaN, 1], [1], 'x', null]) {
      expect(cleanGeometry({ type: 'Point', coordinates: c })).toBeNull();
    }
  });
  it('rejects null, unknown and non-object geometry', () => {
    for (const g of [null, undefined, 5, 'x', {}, { type: 'GeometryCollection' }, { type: 'Point' }]) expect(cleanGeometry(g)).toBeNull();
  });
  it('lines lose bad vertices and need two left', () => {
    expect(cleanGeometry({ type: 'LineString', coordinates: [[0, 0], [0, 99], [1, 1]] }).coordinates).toEqual([[0, 0], [1, 1]]);
    expect(cleanGeometry({ type: 'LineString', coordinates: [[0, 0], [0, 99]] })).toBeNull();
  });
  it('polygons are dropped whole when a vertex is bad or a ring is degenerate', () => {
    expect(cleanGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] })).toBeNull(); // 2-point ring
    expect(cleanGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 95], [0, 1], [0, 0]]] })).toBeNull();
    expect(cleanGeometry({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
  it('multi-geometries keep their valid parts', () => {
    expect(cleanGeometry({ type: 'MultiPoint', coordinates: [[1, 1], [1, 99]] }).coordinates).toEqual([[1, 1]]);
    expect(cleanGeometry({ type: 'MultiPolygon', coordinates: [[sq], [[[0, 0], [1, 1]]]] }).coordinates).toHaveLength(1);
  });
});

describe('cleanFeatures', () => {
  it('counts what it dropped', () => {
    const r = cleanFeatures([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [4.9, 52.3] } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [4.9, 95] } },
      { type: 'Feature', geometry: null },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] } },
      null,
    ]);
    expect(r.features).toHaveLength(1);
    expect(r.dropped).toBe(4);
  });
  it('tolerates non-arrays', () => {
    expect(cleanFeatures(undefined)).toEqual({ features: [], dropped: 0 });
  });
});
