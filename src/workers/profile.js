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

/** Extra profile samples (m from each terminal) where the ~1 km grid is coarser. */
export const NEAR_TERMINAL_M = [25, 50, 100, 200, 400];

/**
 * Tx→rx profile in the P.1812 contract: ~1 km spacing (10–60 intervals),
 * BOTH endpoints included, bare DEM heights (no earth-bulge folding — P.1812
 * handles curvature itself via its effective-earth radii) plus a representative
 * clutter height per point (0 when no land-cover sampler is supplied — the
 * DSM-only terrain-only mode, see docs/decisions/0005).
 *
 * P.1812-8 has no separate terminal clutter loss: clutter next to a terminal
 * blocks the path through the Bullington profile. With ~1 km spacing the
 * trees or buildings around a handheld would fall between samples, so the
 * profile also samples NEAR_TERMINAL_M from both ends (where finer than the
 * grid and inside the half-path).
 *
 * @param tx   { lng, lat }
 * @param rx   { lng, lat }
 * @param totalDist  haversine distance in metres (pre-computed)
 * @param dem  elevation sampler ({ sample }) — required (caller falls back to
 *             FSPL+Deygout without terrain)
 * @param clutter  E1 clutter sampler ({ heightM }), or null
 * @returns    Array of { distM, terrainM, clutterM }
 */
export function buildProfileP1812(tx, rx, totalDist, dem, clutter) {
  const n = Math.max(10, Math.min(60, Math.round(totalDist / 1000)));
  const step = totalDist / n;
  const fracs = [];
  for (let i = 0; i <= n; i++) fracs.push(i / n);
  for (const m of NEAR_TERMINAL_M) {
    if (m >= step || m >= totalDist / 2) continue;
    fracs.push(m / totalDist, 1 - m / totalDist);
  }
  fracs.sort((a, b) => a - b);
  const profile = [];
  for (const f of fracs) {
    const lng = tx.lng + (rx.lng - tx.lng) * f;
    const lat = tx.lat + (rx.lat - tx.lat) * f;
    profile.push({
      distM: f * totalDist,
      terrainM: dem.sample(lng, lat),
      clutterM: clutter ? clutter.heightM(lng, lat) : 0,
    });
  }
  return profile;
}
