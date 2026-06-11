/**
 * M21 §A — mission file: save/load the full mission as a local
 * `*.groundlink.json`. Pure + DOM-free (unit-testable); main.js gathers the
 * state and applies the parsed mission back through the domain modules.
 *
 * The file stores INPUTS ONLY — results are recomputed on load. Serialization
 * is whitelist-only: every block copies named fields, so computed results,
 * API keys or any stray state on the gathered object can never leak into the
 * file (OPSEC). The file contains the user's coordinates and stays local —
 * the save dialog says so.
 */

export const MISSION_FORMAT = 'groundlink-mission';
export const MISSION_VERSION = 1;
export const MISSION_EXT = '.groundlink.json';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === 'string' ? v : '');
const bool = (v) => Boolean(v);

/** A named lat/lng entry ({lat, lng, name}); null when coords are bad. */
function namedPoint(p) {
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng, name: str(p.name) };
}

function vertex(p) {
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function waypoint(p) {
  const base = namedPoint(p);
  return base ? { ...base, icon: str(p.icon) || 'point' } : null;
}

const cleanList = (arr, fn) => (Array.isArray(arr) ? arr.map(fn).filter(Boolean) : []);

/** Deep JSON-safe clone for user-authored lists (arsenal/structures/teams). */
function jsonClone(v) {
  return v == null ? [] : JSON.parse(JSON.stringify(v));
}

function cleanAoi(aoi) {
  if (!aoi || typeof aoi !== 'object') return null;
  if (aoi.type === 'radius') {
    const center = vertex(aoi.center);
    const radiusM = num(aoi.radiusM);
    return center && radiusM ? { type: 'radius', center, radiusM } : null;
  }
  if (aoi.type === 'polygon') {
    const ring = (Array.isArray(aoi.ring) ? aoi.ring : [])
      .map((c) => (Array.isArray(c) && num(c[0]) != null && num(c[1]) != null ? [num(c[0]), num(c[1])] : null))
      .filter(Boolean);
    return ring.length >= 3 ? { type: 'polygon', ring } : null;
  }
  return null;
}

function cleanDrone(d) {
  if (!d || !Array.isArray(d.lngLat)) return null;
  const lng = num(d.lngLat[0]);
  const lat = num(d.lngLat[1]);
  if (lng == null || lat == null) return null;
  return { lngLat: [lng, lat], altM: num(d.altM) ?? 120 };
}

function cleanCoverage(c) {
  if (!c || typeof c !== 'object') return null;
  const t = c.thresholds || {};
  return {
    freqMHz: num(c.freqMHz),
    powerW: num(c.powerW),
    txHeightM: num(c.txHeightM),
    rxHeightM: num(c.rxHeightM),
    useTerrain: bool(c.useTerrain),
    useClutter: bool(c.useClutter),
    thresholds: {
      excellent: num(t.excellent),
      good: num(t.good),
      marginal: num(t.marginal),
      none: num(t.none),
    },
    digitalMode: str(c.digitalMode) || 'Analogue',
  };
}

function cleanPace(p) {
  if (!p || typeof p !== 'object') return null;
  return { ewThreat: str(p.ewThreat) || 'medium', cellForPace: str(p.cellForPace) || 'none' };
}

function cleanPower(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    hours: num(p.hours),
    everyMin: num(p.everyMin),
    txMin: num(p.txMin),
    continuousH: num(p.continuousH),
    bankV: num(p.bankV),
    droneWh: num(p.droneWh),
    atakMa: num(p.atakMa),
    atakMah: num(p.atakMah),
  };
}

function cleanBasemap(b) {
  if (!b || typeof b !== 'object' || !b.category) return null;
  return { category: str(b.category), variant: str(b.variant) || null };
}

/** Whitelist-copy one gathered state (or parsed file block) into mission shape. */
function cleanMission(m) {
  const src = m && typeof m === 'object' ? m : {};
  return {
    aoi: cleanAoi(src.aoi),
    sites: cleanList(src.sites, namedPoint),
    points: cleanList(src.points, namedPoint),
    route: cleanList(src.route, vertex),
    waypoints: cleanList(src.waypoints, waypoint),
    drone: cleanDrone(src.drone),
    arsenal: jsonClone(Array.isArray(src.arsenal) ? src.arsenal : []),
    structures: jsonClone(Array.isArray(src.structures) ? src.structures : []),
    coverage: cleanCoverage(src.coverage),
    pace: cleanPace(src.pace),
    power: cleanPower(src.power),
    teams: jsonClone(Array.isArray(src.teams) ? src.teams : []),
    basemap: cleanBasemap(src.basemap),
    opDatetime: str(src.opDatetime) || null,
  };
}

/** Serialize a gathered mission state into the v1 file object. */
export function serializeMission(state, { savedAt } = {}) {
  return {
    format: MISSION_FORMAT,
    version: MISSION_VERSION,
    savedAt: savedAt ?? null,
    mission: cleanMission(state),
  };
}

/** Validate a parsed object; { ok, mission } or { ok: false, error }. */
export function validateMission(obj) {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'Not a GroundLink mission file.' };
  }
  if (obj.format !== MISSION_FORMAT) {
    return { ok: false, error: 'Not a GroundLink mission file (missing format marker).' };
  }
  const v = Number(obj.version);
  if (!Number.isFinite(v)) {
    return { ok: false, error: 'Mission file has no readable version.' };
  }
  if (v > MISSION_VERSION) {
    return {
      ok: false,
      error: `Mission file is v${v}, saved by a newer GroundLink — this app reads up to v${MISSION_VERSION}. Update the app?`,
    };
  }
  // v1 parser tolerates missing optional blocks (forward-compatible adds).
  return { ok: true, version: v, savedAt: str(obj.savedAt) || null, mission: cleanMission(obj.mission) };
}

/** Parse mission-file text; { ok, mission } or { ok: false, error }. */
export function parseMission(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Malformed JSON — could not read the mission file.' };
  }
  return validateMission(obj);
}

/** Suggested filename: mission-YYYYMMDD-HHmm.groundlink.json (local time). */
export function missionFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `mission-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${MISSION_EXT}`;
}

/** Filename routing for the import pipeline. */
export function looksLikeMissionFile(name) {
  return String(name ?? '').toLowerCase().endsWith(MISSION_EXT);
}

/** Content sniff for plain .json files that are really mission files. */
export function isMissionData(obj) {
  return Boolean(obj && typeof obj === 'object' && obj.format === MISSION_FORMAT);
}
