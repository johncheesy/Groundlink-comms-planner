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

import { normalizeAntenna } from '../coverage/antenna.js';
import { LIMITS, strictNum, isLatLng, clipName } from '../geo/validate.js';
import { SITE_RF_LIMITS } from '../mission/mission.js';

export const MISSION_FORMAT = 'groundlink-mission';
export const MISSION_VERSION = 1;
export const MISSION_EXT = '.groundlink.json';


// strictNum, not Number(): Number(null) and Number('') are 0, which used to move
// a site with a missing coordinate to 0°N 0°E without a word.
const num = strictNum;
const str = (v) => (typeof v === 'string' ? v : '');
const bool = (v) => Boolean(v);

/** A named lat/lng entry ({lat, lng, name}); null when coords are missing or out of range. */
function namedPoint(p) {
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  if (lat == null || lng == null || !isLatLng(lat, lng)) return null;
  return { lat, lng, name: clipName(p.name) };
}

/**
 * A site: a named point plus its own antenna pointing (M49), mast height and
 * power (M50) when set. Out-of-range height/power is clamped like the panel.
 */
function site(p) {
  const out = namedPoint(p);
  if (!out) return null;
  const az = num(p?.azimuthDeg);
  if (az != null) out.azimuthDeg = ((az % 360) + 360) % 360;
  for (const key of ['txHeightM', 'powerW']) {
    const v = num(p?.[key]);
    const [lo, hi] = SITE_RF_LIMITS[key];
    if (v != null) out[key] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

/**
 * Radio links (M50) refer to sites by their index in the file's `sites` list.
 * `siteIndex` maps a file index to the index after cleaning (null when that
 * site was dropped), so links follow their sites when a bad one is skipped.
 * Links to a missing site, self-links and duplicate pairs are dropped.
 */
function cleanLinks(arr, siteIndex, report) {
  const input = Array.isArray(arr) ? arr : [];
  const seen = new Set();
  const out = [];
  for (const l of input) {
    const a = siteIndex[num(l?.a)] ?? null;
    const b = siteIndex[num(l?.b)] ?? null;
    if (a == null || b == null || a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link = { a, b, label: clipName(l.label) };
    const f = num(l.freqMHz);
    if (f != null && f >= 1 && f <= 100000) link.freqMHz = f;
    out.push(link);
  }
  if (report && input.length > out.length) report.dropped.links = input.length - out.length;
  if (report && out.length > LIMITS.links) report.truncated.links = { over: out.length - LIMITS.links, max: LIMITS.links };
  return out.slice(0, LIMITS.links);
}

/** File index → cleaned index for the sites list (null = dropped or over the limit). */
function siteIndexMap(arr) {
  const map = [];
  let k = 0;
  (Array.isArray(arr) ? arr : []).forEach((p, i) => {
    map[i] = site(p) && k < LIMITS.sites ? k++ : null;
  });
  return map;
}

function vertex(p) {
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  if (lat == null || lng == null || !isLatLng(lat, lng)) return null;
  return { lat, lng };
}

function waypoint(p) {
  const base = namedPoint(p);
  return base ? { ...base, icon: str(p.icon) || 'point' } : null;
}

/**
 * Clean a list, keep at most `max`, and record what was lost in `report`
 * (`dropped` = unusable entries, `truncated` = valid entries over the limit).
 */
function cleanListReport(arr, fn, key, max, report) {
  const input = Array.isArray(arr) ? arr : [];
  const valid = input.map(fn).filter(Boolean);
  if (report) {
    if (input.length > valid.length) report.dropped[key] = input.length - valid.length;
    if (valid.length > max) report.truncated[key] = { over: valid.length - max, max };
  }
  return valid.slice(0, max);
}

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
      .map((c) => (Array.isArray(c) && num(c[0]) != null && num(c[1]) != null && isLatLng(num(c[1]), num(c[0])) ? [num(c[0]), num(c[1])] : null))
      .filter(Boolean);
    return ring.length >= 3 && ring.length === (Array.isArray(aoi.ring) ? aoi.ring.length : -1) ? { type: 'polygon', ring } : null;
  }
  return null;
}

function cleanDrone(d) {
  if (!d || !Array.isArray(d.lngLat)) return null;
  const lng = num(d.lngLat[0]);
  const lat = num(d.lngLat[1]);
  if (lng == null || lat == null || !isLatLng(lat, lng)) return null;
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
    // Antenna fields arrived after v1 files existed; absent → dipole, 0 dBi.
    ...(c.antenna && typeof c.antenna === 'object' ? { antenna: normalizeAntenna(c.antenna) } : {}),
    ...(num(c.rxGainDbi) != null ? { rxGainDbi: num(c.rxGainDbi) } : {}),
    ...(num(c.txLossDb) != null ? { txLossDb: Math.min(30, Math.max(0, num(c.txLossDb))) } : {}),
    thresholds: {
      excellent: num(t.excellent),
      good: num(t.good),
      marginal: num(t.marginal),
      none: num(t.none),
    },
    digitalMode: str(c.digitalMode) || 'Analogue',
    // Propagation model (optional; files without it keep the planner's choice).
    ...(ENGINES.includes(c.engine) ? { engine: c.engine } : {}),
  };
}

const ENGINES = ['auto', 'p1812', 'builtin', 'cloudrf'];

/**
 * Saved camera (optional): where the map looks, its tilt and rotation, and
 * whether 3D terrain is on — so a demo or briefing file opens on the view it
 * was saved with. Out-of-range values are clamped; a bad centre drops it.
 */
function cleanView(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.center)) return null;
  const [lng, lat] = v.center.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  const clamp = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : d);
  return {
    center: [lng, lat],
    zoom: clamp(v.zoom, 0, 22, 10),
    pitch: clamp(v.pitch, 0, 85, 0),
    bearing: clamp(v.bearing, -360, 360, 0),
    terrain3d: v.terrain3d === true,
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
function cleanMission(m, report) {
  const src = m && typeof m === 'object' ? m : {};
  const aoi = cleanAoi(src.aoi);
  const drone = cleanDrone(src.drone);
  if (report) {
    if (src.aoi && !aoi) report.invalid.push('area of interest');
    if (src.drone && !drone) report.invalid.push('drone position');
  }
  return {
    aoi,
    sites: cleanListReport(src.sites, site, 'sites', LIMITS.sites, report),
    links: cleanLinks(src.links, siteIndexMap(src.sites), report),
    points: cleanListReport(src.points, namedPoint, 'points', LIMITS.points, report),
    route: cleanListReport(src.route, vertex, 'route vertices', LIMITS.routeVertices, report),
    waypoints: cleanListReport(src.waypoints, waypoint, 'waypoints', LIMITS.waypoints, report),
    drone,
    arsenal: jsonClone(Array.isArray(src.arsenal) ? src.arsenal : []),
    structures: jsonClone(Array.isArray(src.structures) ? src.structures : []),
    coverage: cleanCoverage(src.coverage),
    pace: cleanPace(src.pace),
    power: cleanPower(src.power),
    teams: jsonClone(Array.isArray(src.teams) ? src.teams : []),
    basemap: cleanBasemap(src.basemap),
    opDatetime: str(src.opDatetime) || null,
    view: cleanView(src.view),
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
  const report = { dropped: {}, truncated: {}, invalid: [] };
  const mission = cleanMission(obj.mission, report);
  return { ok: true, version: v, savedAt: str(obj.savedAt) || null, mission, warnings: reportWarnings(report) };
}

/** Human sentences for whatever the cleaner had to skip. Empty when nothing was lost. */
export function reportWarnings(report) {
  const out = [];
  for (const [key, n] of Object.entries(report.dropped)) {
    out.push(`${n} ${key} skipped: missing or invalid coordinates.`);
  }
  for (const [key, t] of Object.entries(report.truncated)) {
    out.push(`${t.over} ${key} skipped: the planner holds at most ${t.max}.`);
  }
  for (const what of report.invalid) out.push(`The ${what} in the file was invalid and was skipped.`);
  return out;
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
