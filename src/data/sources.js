/**
 * Data-source interfaces (E1 §A) — the seam between propagation engines and
 * concrete datasets. Engines (P.1812, FSPL+Deygout, recommend) depend on the
 * samplers built here, never on a specific source.
 *
 * Elevation sampler:  { id, sample(lng, lat) → metres }
 * Clutter sampler:    { id, heightM(lng, lat) → m above ground,
 *                       dbAt(lng, lat) → extra path-loss dB (fallback engine) }
 *
 * Build order (first available wins):
 *   elevation: local COG file (composed over Terrarium where the file has no
 *              data) → OPFS offline package → network Terrarium.
 *   clutter:   local COG file (canopy/DSM heights) → ESA WorldCover WMS
 *              (Africa) → none.
 *
 * The local-COG path is the OPSEC-clean runtime entry for the no-CORS public
 * datasets (Copernicus GLO-30, WorldCover COG, Meta canopy — CORS table in
 * docs/E1-pmtiles-cog-data.md): the user stages the GeoTIFF once and loads it
 * from disk; bytes never leave the browser. Worker-safe throughout.
 */

import { buildDem, pickZoom } from '../workers/dem.js';
import { buildLandcover, clutterDbForClass, clutterHeightForClass } from '../workers/worldcover.js';
import { buildCogSampler } from './cog.js';
import { offlineTileGetter } from './offline.js';

/**
 * Representative clutter loss (dB) for a bare height (m) when no land-cover
 * class is known (canopy/DSM COGs carry heights only). Log fit to the
 * WorldCover class table in worldcover.js (20 m trees → 12 dB, 8 m built →
 * 10 dB, 4 m shrub → 6 dB, 2 m crop → 3 dB), capped at the mangrove ceiling.
 */
export function clutterDbForHeight(h) {
  if (!(h > 0)) return 0;
  return Math.min(14, 4.3 * Math.log(1 + h));
}

/**
 * Elevation sampler for bounds. Priority: local COG → OPFS package → network
 * Terrarium. Returns null when nothing is available (flat-earth fallback).
 *
 * @param {object} o
 * @param {object} o.bounds   { west, south, east, north }
 * @param {File|Blob|string|null} [o.cog]  local COG file or CORS-enabled URL
 */
export async function buildElevationSampler({ bounds, cog = null }) {
  let base = null;
  let baseId = null;

  const offline = await offlineTileGetter(bounds).catch(() => null);
  if (offline) {
    // Best packaged zoom not exceeding what we'd pick online (else coarsest).
    const want = pickZoom(bounds);
    const z = [...offline.zooms].filter((zz) => zz <= want).pop() ?? offline.zooms[0];
    base = await buildDem(bounds, z, offline.getTile).catch(() => null);
    if (base) baseId = 'offline';
  }
  if (!base) {
    base = await buildDem(bounds).catch(() => null);
    if (base) baseId = 'terrarium';
  }

  if (cog) {
    const cogSampler = await buildCogSampler(cog, bounds, { neutral: NaN, interpolate: true });
    if (cogSampler) {
      const fallback = base;
      return {
        id: fallback ? `cog+${baseId}` : 'cog',
        sample(lng, lat) {
          const v = cogSampler.sample(lng, lat);
          if (!Number.isNaN(v)) return v;
          return fallback ? fallback.sample(lng, lat) : 0;
        },
      };
    }
  }
  return base ? { id: baseId, sample: base.sample } : null;
}

/**
 * Clutter sampler for bounds. Priority: local COG (heights) → WorldCover WMS
 * (classes → heights + dB). Returns null when neither is available.
 */
export async function buildClutterSampler({ bounds, cog = null }) {
  if (cog) {
    const cogSampler = await buildCogSampler(cog, bounds, { neutral: 0, interpolate: false });
    if (cogSampler) {
      return {
        id: 'cog',
        heightM: (lng, lat) => Math.max(0, cogSampler.sample(lng, lat) || 0),
        dbAt(lng, lat) {
          return clutterDbForHeight(Math.max(0, cogSampler.sample(lng, lat) || 0));
        },
      };
    }
  }
  const lc = await buildLandcover(bounds).catch(() => null);
  if (!lc) return null;
  return {
    id: 'worldcover',
    heightM: (lng, lat) => clutterHeightForClass(lc.sample(lng, lat)),
    dbAt: (lng, lat) => clutterDbForClass(lc.sample(lng, lat)),
  };
}
