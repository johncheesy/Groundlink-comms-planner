import { describe, it, expect } from 'vitest';
import { parseMission, serializeMission, MISSION_FORMAT } from './mission.js';
import { LIMITS } from '../geo/validate.js';
import { createMission } from '../mission/mission.js';

const file = (mission) => JSON.stringify({ format: MISSION_FORMAT, version: 1, mission });
const site = (lat, lng, name = 'S') => ({ lat, lng, name });

describe('parseMission: coordinates', () => {
  it('keeps valid sites and reports nothing', () => {
    const r = parseMission(file({ sites: [site(52.3, 4.9), site(-33.9, 18.4)] }));
    expect(r.ok).toBe(true);
    expect(r.mission.sites).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });
  it('drops out-of-range coordinates and says so (lat 95 used to crash the load)', () => {
    const r = parseMission(file({ sites: [site(95, 4), site(10, 400), site(52, 4)] }));
    expect(r.mission.sites).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/2 sites skipped/);
  });
  it('a missing coordinate is dropped, not silently moved to 0°N 0°E', () => {
    const r = parseMission(file({ sites: [site(null, 4), site(52, undefined), site('', 4), site(true, 4), site(0, 0)] }));
    expect(r.mission.sites).toEqual([{ lat: 0, lng: 0, name: 'S' }]); // only the genuine 0,0
    expect(r.warnings.join(' ')).toMatch(/4 sites skipped/);
  });
  it('accepts numeric strings', () => {
    expect(parseMission(file({ sites: [site('52.5', '4.5')] })).mission.sites).toHaveLength(1);
  });
  it('invalid AOI, polygon vertex and drone are skipped with a message', () => {
    const r = parseMission(file({
      aoi: { type: 'radius', center: { lat: 95, lng: 0 }, radiusM: 1000 },
      drone: { lngLat: [500, 10], altM: 100 },
    }));
    expect(r.mission.aoi).toBeNull();
    expect(r.mission.drone).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/area of interest/);
    expect(r.warnings.join(' ')).toMatch(/drone position/);
    const poly = parseMission(file({ aoi: { type: 'polygon', ring: [[0, 0], [1, 0], [1, 95], [0, 1]] } }));
    expect(poly.mission.aoi).toBeNull(); // a polygon with a bad vertex is not silently reshaped
  });
});

describe('parseMission: size limits', () => {
  it('caps sites and reports the overflow', () => {
    const sites = Array.from({ length: LIMITS.sites + 25 }, (_, i) => site(52 + i * 1e-4, 4));
    const r = parseMission(file({ sites }));
    expect(r.mission.sites).toHaveLength(LIMITS.sites);
    expect(r.warnings.join(' ')).toMatch(new RegExp(`25 sites skipped: the planner holds at most ${LIMITS.sites}`));
  });
  it('clips very long names', () => {
    const r = parseMission(file({ sites: [site(1, 1, 'x'.repeat(100_000))] }));
    expect(r.mission.sites[0].name.length).toBe(LIMITS.nameLen);
  });
  it('caps route vertices', () => {
    const route = Array.from({ length: LIMITS.routeVertices + 10 }, (_, i) => ({ lat: 1 + i * 1e-5, lng: 1 }));
    const r = parseMission(file({ route }));
    expect(r.mission.route).toHaveLength(LIMITS.routeVertices);
  });
});

describe('serialize → parse round trip', () => {
  it('is lossless for valid data and warns about nothing', () => {
    const state = { sites: [site(52.1, 4.1, 'A')], points: [site(52.2, 4.2, 'B')], route: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] };
    const r = parseMission(JSON.stringify(serializeMission(state)));
    expect(r.mission.sites).toEqual(state.sites);
    expect(r.mission.points).toEqual(state.points);
    expect(r.mission.route).toEqual(state.route);
    expect(r.warnings).toEqual([]);
  });
});

describe('mission model limits', () => {
  it('rejects invalid positions and returns null', () => {
    const m = createMission();
    expect(m.addSite(95, 0)).toBeNull();
    expect(m.addSite(NaN, 0)).toBeNull();
    expect(m.addPoint(0, 181)).toBeNull();
    expect(m.getSites()).toHaveLength(0);
  });
  it('stops at the site limit and reports capacity', () => {
    const m = createMission();
    for (let i = 0; i < LIMITS.sites; i++) expect(m.addSite(1, 1 + i * 1e-4)).not.toBeNull();
    expect(m.capacity().sites).toBe(0);
    expect(m.addSite(1, 2)).toBeNull();
    expect(m.getSites()).toHaveLength(LIMITS.sites);
  });
  it('stops at the point limit', () => {
    const m = createMission();
    for (let i = 0; i < LIMITS.points; i++) m.addPoint(1, 1 + i * 1e-4);
    expect(m.addPoint(1, 2)).toBeNull();
  });
  it('clips names on add and rename', () => {
    const m = createMission();
    const s = m.addSite(1, 1, 'y'.repeat(5000));
    expect(s.name.length).toBe(LIMITS.nameLen);
    m.renameSite(s.id, 'z'.repeat(5000));
    expect(m.getSites()[0].name.length).toBe(LIMITS.nameLen);
  });
  it('move ignores an invalid position', () => {
    const m = createMission();
    const s = m.addSite(1, 1);
    m.moveSite(s.id, 95, 1);
    expect(m.getSites()[0].lat).toBe(1);
  });
  it('setRoute drops invalid vertices, thins long tracks, keeps both ends, and reports', () => {
    const m = createMission();
    const track = Array.from({ length: 10_000 }, (_, i) => ({ lat: 10 + i * 1e-4, lng: 20 }));
    track.splice(5, 0, { lat: 99, lng: 0 });
    const r = m.setRoute(track);
    const route = m.getRoute();
    expect(route).toHaveLength(LIMITS.routeVertices);
    expect(r).toEqual({ kept: LIMITS.routeVertices, dropped: 1, thinned: 10_000 - LIMITS.routeVertices });
    expect(route[0].lat).toBeCloseTo(10, 6);
    expect(route[route.length - 1].lat).toBeCloseTo(10 + 9999 * 1e-4, 6);
  });
});
