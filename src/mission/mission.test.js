import { describe, it, expect } from 'vitest';
import { createMission, resampleRoute } from './mission.js';
import { haversineM } from '../coverage/model.js';

describe('resampleRoute', () => {
  it('returns [] for under two vertices', () => {
    expect(resampleRoute([])).toEqual([]);
    expect(resampleRoute([{ lat: 1, lng: 1 }])).toHaveLength(1);
  });

  it('samples a straight ~1 km leg roughly every 250 m', () => {
    // ~0.009° lat ≈ 1 km at the equator.
    const out = resampleRoute([{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }], 250);
    // ~1000 m / 250 m ≈ 4–5 samples incl. endpoints.
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(6);
    // consecutive spacing never far above the step
    for (let i = 1; i < out.length; i++) {
      const d = haversineM(out[i - 1].lat, out[i - 1].lng, out[i].lat, out[i].lng);
      expect(d).toBeLessThanOrEqual(260);
    }
    // covers the route to its end (last sample within a step of the endpoint)
    const last = out[out.length - 1];
    expect(haversineM(last.lat, last.lng, 0.009, 0)).toBeLessThanOrEqual(260);
  });
});

describe('mission demand merge', () => {
  it('merges route samples + explicit points (no AOI)', () => {
    const m = createMission();
    m.setRoute([{ lat: 0, lng: 0 }, { lat: 0.009, lng: 0 }]);
    m.addPoint(1, 1, 'OP Alpha');
    const demand = m.demandPoints();
    expect(demand.length).toBeGreaterThanOrEqual(5); // route samples + 1 point
    expect(demand).toContainEqual({ lat: 1, lng: 1 });
  });

  it('includes an AOI grid when an AOI is set', () => {
    const m = createMission();
    m.setAoi({
      type: 'radius',
      center: { lat: 50, lng: 5 },
      radiusM: 10000,
      bounds: { west: 4.8, south: 49.9, east: 5.2, north: 50.1 },
      ring: null,
    });
    const demand = m.demandPoints();
    expect(demand.length).toBeGreaterThan(50); // masked grid → hundreds of points
  });
});

describe('mission events + bbox', () => {
  it('emits a summary on every mutation', () => {
    const seen = [];
    const m = createMission({ onChange: (s) => seen.push(s) });
    m.addSite(50, 5, 'Mast 1');
    m.addPoint(51, 6);
    expect(seen.at(-1)).toMatchObject({ sites: 1, points: 1, isEmpty: false });
  });

  it('computes a bbox spanning all element types', () => {
    const m = createMission();
    m.addSite(50, 5);
    m.addPoint(52, 7);
    const b = m.bbox();
    expect(b.south).toBeCloseTo(50);
    expect(b.north).toBeCloseTo(52);
    expect(b.west).toBeCloseTo(5);
    expect(b.east).toBeCloseTo(7);
  });

  it('reports empty until two route vertices exist', () => {
    const m = createMission();
    expect(m.summary().isEmpty).toBe(true);
    m.addRouteVertex(0, 0);
    expect(m.summary().isEmpty).toBe(true); // a single vertex is not yet a route
    m.addRouteVertex(0, 0.01);
    expect(m.summary().isEmpty).toBe(false);
  });
});
