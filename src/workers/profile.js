import { earthBulgeM } from '../coverage/model.js';
import { clutterHeightForClass } from './worldcover.js';

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

/**
 * Tx→rx profile in the P.1812 contract: ~1 km spacing (10–60 intervals),
 * BOTH endpoints included, bare DEM heights (no earth-bulge folding — P.1812
 * handles curvature itself via its effective-earth radii) plus a representative
 * clutter height per point (0 when no land-cover sampler is supplied — the
 * DSM-only terrain-only mode, see docs/decisions/0005).
 *
 * @param tx   { lng, lat }
 * @param rx   { lng, lat }
 * @param totalDist  haversine distance in metres (pre-computed)
 * @param dem  DEM sampler from buildDem() — required (caller falls back to
 *             FSPL+Deygout without terrain)
 * @param landcover  land-cover sampler from buildLandcover(), or null
 * @returns    Array of { distM, terrainM, clutterM }
 */
export function buildProfileP1812(tx, rx, totalDist, dem, landcover) {
  const n = Math.max(10, Math.min(60, Math.round(totalDist / 1000)));
  const profile = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const lng = tx.lng + (rx.lng - tx.lng) * f;
    const lat = tx.lat + (rx.lat - tx.lat) * f;
    profile.push({
      distM: f * totalDist,
      terrainM: dem.sample(lng, lat),
      clutterM: landcover ? clutterHeightForClass(landcover.sample(lng, lat)) : 0,
    });
  }
  return profile;
}
