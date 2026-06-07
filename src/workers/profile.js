import { earthBulgeM } from '../coverage/model.js';

/**
 * Elevation profile between tx and rx, sampled at ~2 km spacing (8–40 points),
 * with the k = 4/3 earth bulge folded into each terrain height so the knife-
 * edge geometry accounts for curvature.
 *
 * Shared by the coverage worker and the recommend worker.
 *
 * @param tx   { lng, lat }
 * @param rx   { lng, lat }
 * @param totalDist  haversine distance in metres (pre-computed)
 * @param dem  DEM sampler from buildDem(), or null for flat-earth fallback
 * @returns    Array of { d, h } or empty array if dem is null
 */
export function buildProfile(tx, rx, totalDist, dem) {
  if (!dem) return [];
  const n = Math.max(8, Math.min(40, Math.round(totalDist / 2000)));
  const profile = [];
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const lng = tx.lng + (rx.lng - tx.lng) * f;
    const lat = tx.lat + (rx.lat - tx.lat) * f;
    const d1 = f * totalDist;
    const h = dem.sample(lng, lat) + earthBulgeM(d1, totalDist - d1);
    profile.push({ d: d1, h });
  }
  return profile;
}
