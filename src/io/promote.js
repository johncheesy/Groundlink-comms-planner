/**
 * Turning imported features into mission input — the pure parts.
 *
 * A planning KMZ often draws its radio links as two-point lines from one
 * tower to the next (the Upemba network: "UPE1 - UPE2", …). linksFromLines()
 * finds the lines whose two ends each sit on a mission site and returns them
 * as site-id pairs, so "Lines → radio links" can recreate the planned links.
 */

import { haversineM } from '../coverage/model.js';

/** Ends further than this from any site do not count as "on" it. */
export const LINK_SNAP_M = 300;

function nearestSite(sites, lng, lat, maxM) {
  let best = null;
  let bestD = Infinity;
  for (const s of sites) {
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (d < bestD) { bestD = d; best = s; }
  }
  return bestD <= maxM ? best : null;
}

/**
 * Radio links implied by imported lines. Pure.
 * @param {Array<GeoJSON.Feature>} features   imported features (any type)
 * @param {Array<{id,lat,lng,name?}>} sites
 * @returns {Array<{a:string, b:string, label:string, featureIndex:number}>}
 *   one per line whose start and end snap to two different sites; no
 *   duplicate pairs (either direction).
 */
export function linksFromLines(features, sites, maxM = LINK_SNAP_M) {
  const out = [];
  const seen = new Set();
  features.forEach((f, featureIndex) => {
    if (f?.geometry?.type !== 'LineString') return;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) return;
    const [lng0, lat0] = c[0];
    const [lng1, lat1] = c[c.length - 1];
    const a = nearestSite(sites, lng0, lat0, maxM);
    const b = nearestSite(sites, lng1, lat1, maxM);
    if (!a || !b || a.id === b.id) return;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a: a.id, b: b.id, label: String(f.properties?.name ?? '').trim(), featureIndex });
  });
  return out;
}

/** Polygons offered as AOI candidates: name and vertex count, largest last. Pure. */
export function polygonChoices(features, max = 4) {
  return features
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f?.geometry?.type === 'Polygon')
    .slice(0, max)
    .map(({ f, i }, n) => ({
      featureIndex: i,
      name: String(f.properties?.name ?? '').trim() || `Polygon ${n + 1}`,
      vertices: (f.geometry.coordinates?.[0]?.length ?? 1) - 1,
    }));
}
