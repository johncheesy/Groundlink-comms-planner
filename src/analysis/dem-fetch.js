/**
 * Main-thread DEM sampler for path profiles (M14).
 *
 * Uses the same terrain source and per-tile decoding as the coverage worker
 * (src/workers/dem.js, src/data/terrain-tiles.js), so a profile and a coverage
 * run see the same ground. A short path gets zoom 12 (Copernicus GLO-30 at
 * about 19 m per pixel at the equator); the zoom steps down when the path would
 * need more than 16 tiles.
 */

import { buildDem } from '../workers/dem.js';
import { lon2tileX, lat2tileY } from '../data/terrain-tiles.js';

const MAX_TILES = 16;

/** Zoom for a bbox: the finest from 12 down to 6 that stays within MAX_TILES. */
export function profileZoom(bounds) {
  for (let z = 12; z >= 6; z--) {
    const cols = Math.floor(lon2tileX(bounds.east, z)) - Math.floor(lon2tileX(bounds.west, z)) + 1;
    const rows = Math.floor(lat2tileY(bounds.south, z)) - Math.floor(lat2tileY(bounds.north, z)) + 1;
    if (cols * rows <= MAX_TILES) return z;
  }
  return 6;
}

/**
 * Fetch a DEM covering both points and return an elevation sampler.
 *
 * @param {{ lat, lng }} a
 * @param {{ lat, lng }} b
 * @param {number} [steps] accepted for symmetry with buildPathProfile (unused)
 * @returns {Promise<{ id, z, sample(lng, lat): number } | null>} null if no tile loaded
 */
export async function fetchDemProfile(a, b, steps) {
  void steps;
  const bounds = {
    west: Math.min(a.lng, b.lng),
    east: Math.max(a.lng, b.lng),
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
  };
  return buildDem(bounds, profileZoom(bounds));
}
