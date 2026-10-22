/**
 * One place for "is this a usable position/name/count" so the mission model,
 * the mission file, imports and the AOI all agree. Pure, no DOM.
 *
 * Limits come from measurement: map markers are redrawn on every refresh at a
 * cost that grows with the square of the count (100 sites 70 ms, 500 sites 1 s,
 * 50 000 sites froze the page for 32 s), so the planner holds a few hundred
 * objects, not thousands. These are planning inputs, not a GIS layer.
 */

export const LIMITS = Object.freeze({
  sites: 300,
  points: 300,
  routeVertices: 2000,
  waypoints: 200,
  nameLen: 80,
});

/** Finite number from a number or non-empty numeric string; null for everything else (null, '', true, NaN). */
export function strictNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A position the map can place: lat in [-90, 90], lng in [-180, 180]. */
export function isLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Trim and cap a user-visible name. Non-strings become ''. */
export function clipName(v, max = LIMITS.nameLen) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Keep at most `max` items, evenly spaced, always including the first and last. */
export function decimate(arr, max) {
  if (!Array.isArray(arr) || arr.length <= max || max < 2) return arr;
  const out = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** Longest sensible mission extent: coverage works on one area at a time. */
export const MAX_SPAN_KM = 800;

/** Diagonal of a { west, south, east, north } box in km (haversine). */
export function spanKm(b) {
  if (!b) return 0;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.north - b.south);
  const dLng = rad(b.east - b.west);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(b.south)) * Math.cos(rad(b.north)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Explain a mission that is too spread out to plan as one area, or null when fine.
 * Without this the compute window grows to cover the gap, runs past valid
 * latitudes, and silently falls back to flat earth.
 */
export function missionSpanProblem(bbox, { maxKm = MAX_SPAN_KM } = {}) {
  const km = spanKm(bbox);
  if (km <= maxKm) return null;
  const rounded = km >= 1000 ? `${Math.round(km / 100) * 100}` : `${Math.round(km / 10) * 10}`;
  return `Your mission spans about ${rounded} km, more than the ${maxKm} km one plan can cover. ` +
    'Remove or move the objects that are far away (sites, points, waypoints, or a stray AOI), or plan each area as its own mission.';
}
