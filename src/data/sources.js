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
 *   elevation: local COG file (composed over the network terrain where the file
 *              has no data) → OPFS offline package → network terrain
 *              (Mapterhorn / Copernicus GLO-30, AWS Terrarium fallback per tile).
 *   clutter:   local COG file (canopy/DSM heights) → ESA WorldCover (global,
 *              Planetary Computer; DEA WMS fallback in Africa) refined by
 *              Meta canopy height (CHM v2, source.coop) and GHSL building
 *              height (jrc-ghsl on AWS) → none.
 *
 * The local-COG path is the OPSEC-clean runtime entry for the no-CORS public
 * datasets (Copernicus GLO-30, WorldCover COG, Meta canopy — CORS table in
 * docs/E1-pmtiles-cog-data.md): the user stages the GeoTIFF once and loads it
 * from disk; bytes never leave the browser. Worker-safe throughout.
 */

import { buildDem, pickZoom } from '../workers/dem.js';
import { buildLandcover, clutterDbForClass, clutterHeightForClass } from '../workers/worldcover.js';
import { buildCanopy } from './canopy.js';
import { buildBuildingHeights } from './buildings.js';
import { offlineTileGetter } from './offline.js';

// cog.js is only needed when the user provides a local COG file; importing it
// statically would pull geotiff + all its decoder chunks (~315 KB) into every
// worker build even when COG is never used. Dynamic import breaks the static
// trace so geotiff stays out of the initial parse in both main thread and workers.

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
    if (base) baseId = base.id || 'terrain';
  }

  if (cog) {
    const { buildCogSampler } = await import('./cog.js');
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

// WorldCover classes where measured canopy height is the better clutter
// height. Built-up keeps its table value (canopy maps miss buildings); bare,
// snow and water stay clear.
const CANOPY_CLASSES = new Set([10, 20, 30, 40, 90, 95, 100]);
const FOREST_CLASSES = new Set([10, 95]); // tree cover, mangrove
const BUILT_UP = 50;

/**
 * Clutter height (m) and loss (dB) for one point from its WorldCover class
 * (0 = unknown), measured canopy height and average building height (0 = none
 * / no data). Built-up takes the measured building height (a village of 5 m
 * houses is lower than a 25 m city centre; the 8 m table value only without
 * data). Forest takes the measured canopy (a young or sparse stand is lower
 * than the 20 m table value); other vegetation takes the taller of table and
 * canopy, so hedges and tree lines in farmland count. Pure.
 */
export function blendClutter(cls, canopyM, buildingM = 0) {
  if (buildingM > 0 && (cls === BUILT_UP || !cls)) {
    const h = cls ? buildingM : Math.max(buildingM, canopyM || 0);
    return { h, db: clutterDbForHeight(h) };
  }
  if (!(canopyM > 0) || (cls && !CANOPY_CLASSES.has(cls))) {
    return { h: clutterHeightForClass(cls), db: clutterDbForClass(cls) };
  }
  const h = !cls || FOREST_CLASSES.has(cls) ? canopyM : Math.max(clutterHeightForClass(cls), canopyM);
  return { h, db: clutterDbForHeight(h) };
}

/**
 * Clutter sampler for bounds. Priority: local COG (heights) → ESA WorldCover
 * classes refined by Meta canopy height and GHSL building height; any subset
 * when the others fail. Throws the LandcoverError (with `.reason`) when none
 * loads, so callers can say why clutter is missing.
 */
export async function buildClutterSampler({ bounds, cog = null }) {
  if (cog) {
    const { buildCogSampler } = await import('./cog.js');
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
  const [lcRes, chmRes, bldRes] = await Promise.allSettled([
    buildLandcover(bounds), buildCanopy(bounds), buildBuildingHeights(bounds),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  const lc = ok(lcRes);
  const chm = ok(chmRes);
  const bld = ok(bldRes);
  if (!lc && !chm && !bld) throw lcRes.reason;
  if (!chm && !bld) {
    return {
      id: lc.id,
      heightM: (lng, lat) => clutterHeightForClass(lc.sample(lng, lat)),
      dbAt: (lng, lat) => clutterDbForClass(lc.sample(lng, lat)),
    };
  }
  const at = (lng, lat) => blendClutter(
    lc ? lc.sample(lng, lat) : 0,
    chm ? chm.heightM(lng, lat) : 0,
    bld ? bld.heightM(lng, lat) : 0,
  );
  return {
    id: [lc, chm, bld].filter(Boolean).map((s) => s.id).join('+'),
    heightM: (lng, lat) => at(lng, lat).h,
    dbAt: (lng, lat) => at(lng, lat).db,
  };
}
