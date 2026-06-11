import { describe, it, expect } from 'vitest';
import {
  MISSION_FORMAT,
  MISSION_VERSION,
  serializeMission,
  parseMission,
  validateMission,
  missionFilename,
  looksLikeMissionFile,
  isMissionData,
} from './mission.js';

// All coordinates in these tests are synthetic (0–2° off Null Island) — OPSEC.

/** A representative full mission state as main.js gathers it. */
function fullState() {
  return {
    aoi: { type: 'radius', center: { lat: 0.5, lng: 0.25 }, radiusM: 3000 },
    sites: [{ lat: 0.6, lng: 0.3, name: 'Mast A' }],
    points: [{ lat: 0.7, lng: 0.35, name: 'OP 1' }],
    route: [
      { lat: 0.5, lng: 0.2 },
      { lat: 0.55, lng: 0.22 },
    ],
    waypoints: [{ lat: 0.65, lng: 0.28, name: 'RV 1', icon: 'point' }],
    drone: { lngLat: [0.4, 0.45], altM: 120 },
    arsenal: [{ id: 'r1', label: 'VHF handheld', defaultFreqMHz: 155, powerW: 5 }],
    structures: [{ id: 's1', name: 'Patrol net' }],
    coverage: {
      freqMHz: 155,
      powerW: 5,
      txHeightM: 10,
      rxHeightM: 1.5,
      useTerrain: true,
      useClutter: false,
      thresholds: { excellent: -85, good: -95, marginal: -103, none: -110 },
      digitalMode: 'Analogue',
    },
    pace: { ewThreat: 'medium', cellForPace: 'none' },
    power: {
      hours: 8, everyMin: 30, txMin: 2, continuousH: 0,
      bankV: 12, droneWh: 370, atakMa: 600, atakMah: 5000,
    },
    teams: [{ id: 't1', name: 'Alpha', operators: 4 }],
    basemap: { category: 'imagery', variant: 'esri' },
    opDatetime: '2026-06-11T12:00',
  };
}

const roundTrip = (state) =>
  parseMission(JSON.stringify(serializeMission(state, { savedAt: '2026-06-11T10:00:00.000Z' })));

describe('mission file — serialize', () => {
  it('stamps format, version and savedAt', () => {
    const out = serializeMission(fullState(), { savedAt: '2026-06-11T10:00:00.000Z' });
    expect(out.format).toBe(MISSION_FORMAT);
    expect(out.version).toBe(MISSION_VERSION);
    expect(out.savedAt).toBe('2026-06-11T10:00:00.000Z');
  });

  it('round-trips the full mission unchanged', () => {
    const state = fullState();
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    expect(r.mission.aoi).toEqual(state.aoi);
    expect(r.mission.sites).toEqual(state.sites);
    expect(r.mission.points).toEqual(state.points);
    expect(r.mission.route).toEqual(state.route);
    expect(r.mission.waypoints).toEqual(state.waypoints);
    expect(r.mission.drone).toEqual(state.drone);
    expect(r.mission.arsenal).toEqual(state.arsenal);
    expect(r.mission.structures).toEqual(state.structures);
    expect(r.mission.coverage).toEqual(state.coverage);
    expect(r.mission.pace).toEqual(state.pace);
    expect(r.mission.power).toEqual(state.power);
    expect(r.mission.teams).toEqual(state.teams);
    expect(r.mission.basemap).toEqual(state.basemap);
    expect(r.mission.opDatetime).toBe(state.opDatetime);
  });

  it('round-trips a polygon AOI', () => {
    const state = { ...fullState(), aoi: { type: 'polygon', ring: [[0.2, 0.2], [0.3, 0.2], [0.25, 0.3]] } };
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    expect(r.mission.aoi).toEqual(state.aoi);
  });

  it('OPSEC: never emits computed results or API keys, even when present on the state', () => {
    const dirty = {
      ...fullState(),
      apiKey: 'sk-SECRET-DO-NOT-SHIP',
      cloudrfApiKey: 'cloudrf-SECRET',
      results: { coveredFrac: 0.92, raster: [1, 2, 3] },
      lastPaint: { classes: new Uint8Array(4) },
      recommendedSites: [{ lat: 0.9, lng: 0.9 }],
    };
    dirty.coverage.apiKey = 'nested-SECRET';
    dirty.coverage.stats = { coveredFrac: 0.92 };
    const text = JSON.stringify(serializeMission(dirty, { savedAt: '2026-06-11T10:00:00.000Z' }));
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('results');
    expect(text).not.toContain('coveredFrac');
    expect(text).not.toContain('recommendedSites');
    expect(text).not.toContain('lastPaint');
  });

  it('tolerates a minimal/empty state (everything optional)', () => {
    const r = roundTrip({});
    expect(r.ok).toBe(true);
    expect(r.mission.aoi).toBeNull();
    expect(r.mission.sites).toEqual([]);
    expect(r.mission.waypoints).toEqual([]);
    expect(r.mission.drone).toBeNull();
  });
});

describe('mission file — parse / validate', () => {
  it('rejects malformed JSON with a clear error', () => {
    const r = parseMission('{not json');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/i);
  });

  it('rejects a non-mission JSON file', () => {
    const r = parseMission(JSON.stringify({ type: 'FeatureCollection', features: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mission/i);
  });

  it('gates on version: newer major → clear error with an update hint', () => {
    const r = validateMission({ format: MISSION_FORMAT, version: MISSION_VERSION + 1, mission: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/newer/i);
  });

  it('rejects a missing or non-numeric version', () => {
    expect(validateMission({ format: MISSION_FORMAT, mission: {} }).ok).toBe(false);
    expect(validateMission({ format: MISSION_FORMAT, version: 'x', mission: {} }).ok).toBe(false);
  });

  it('tolerates missing optional blocks (forward-compatible v1 adds)', () => {
    const r = validateMission({
      format: MISSION_FORMAT,
      version: 1,
      mission: { sites: [{ lat: 0.5, lng: 0.5, name: 'Mast A' }] },
    });
    expect(r.ok).toBe(true);
    expect(r.mission.sites).toHaveLength(1);
    expect(r.mission.points).toEqual([]);
    expect(r.mission.route).toEqual([]);
    expect(r.mission.arsenal).toEqual([]);
    expect(r.mission.coverage).toBeNull();
    expect(r.mission.basemap).toBeNull();
  });

  it('drops entries without finite coordinates instead of failing the file', () => {
    const r = validateMission({
      format: MISSION_FORMAT,
      version: 1,
      mission: {
        sites: [{ lat: 0.5, lng: 0.5 }, { lat: 'x', lng: 0.5 }, null],
        waypoints: [{ lat: 0.6, lng: 0.6 }, { name: 'no coords' }],
      },
    });
    expect(r.ok).toBe(true);
    expect(r.mission.sites).toHaveLength(1);
    expect(r.mission.waypoints).toHaveLength(1);
  });
});

describe('mission file — helpers', () => {
  it('suggests mission-YYYYMMDD-HHmm.groundlink.json', () => {
    expect(missionFilename(new Date(2026, 5, 11, 9, 5))).toBe('mission-20260611-0905.groundlink.json');
  });

  it('recognises mission files by name and by content', () => {
    expect(looksLikeMissionFile('patrol.groundlink.json')).toBe(true);
    expect(looksLikeMissionFile('PATROL.GROUNDLINK.JSON')).toBe(true);
    expect(looksLikeMissionFile('area.geojson')).toBe(false);
    expect(looksLikeMissionFile('area.json')).toBe(false);
    expect(isMissionData({ format: MISSION_FORMAT, version: 1 })).toBe(true);
    expect(isMissionData({ type: 'FeatureCollection' })).toBe(false);
    expect(isMissionData(null)).toBe(false);
  });
});
