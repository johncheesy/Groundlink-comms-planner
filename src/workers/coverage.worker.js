/**
 * Coverage compute Web Worker.
 *
 * Computes received signal over a grid covering the AOI bbox, off the main
 * thread. Two paths:
 *   - terrain-aware: FSPL + Deygout single knife-edge over a real elevation
 *     profile (AWS Terrarium DEM), k = 4/3 effective-earth bulge baked in.
 *   - flat fallback: FSPL only (when terrain is off or the DEM is unavailable).
 *
 * Default binding link = talk-in (handheld → repeater): the path loss is
 * reciprocal, so we model one transmitter at the AOI centre with editable
 * tx/rx antenna heights.
 *
 * Grid orientation: row 0 = north edge, col 0 = west edge.
 *
 * Message in:  { type:'compute', id, bounds, cols, rows, tx:{lat,lng},
 *                aoi?:{ type, center:{lat,lng}, radiusM, ring },  // optional mask
 *                params:{ eirpDbm, freqMHz, rxGainDbi, clutterDb, thresholds,
 *                         floorDbm, useTerrain, txHeightM, rxHeightM } }
 * Messages out:
 *   { type:'progress', id, done, total, phase }
 *   { type:'done', id, cols, rows, classes:Uint8Array (transferred), terrain,
 *     clutter, totalCells, inAoi, coveredInAoi, coveredFracAoi }
 *
 * The whole bbox rectangle is always computed and painted (signal that spills
 * beyond the AOI is correct to show). When an `aoi` mask is supplied, the
 * in-AOI cells are counted separately so the coverage fraction is reported
 * against the drawn area, not the bounding box. Without `aoi`, the AOI fields
 * are null and callers fall back to the bbox fraction (drone relay).
 */
import { receivedDbm, classifyDbm, haversineM, deygoutLossDb } from '../coverage/model.js';
import { buildDem } from './dem.js';
import { buildLandcover, clutterDbForClass } from './worldcover.js';
import { buildProfile } from './profile.js';

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg?.type !== 'compute') return;
  const { id, bounds, cols, rows, tx, params, aoi } = msg;
  const { west, south, east, north } = bounds;
  const { thresholds, floorDbm } = params;

  // Optional terrain + clutter (fetched in parallel before the sweep).
  let dem = null;
  let landcover = null;
  if (params.useTerrain || params.useClutter) {
    self.postMessage({ type: 'progress', id, done: 0, total: rows, phase: 'data' });
    const [d, lc] = await Promise.all([
      params.useTerrain ? buildDem(bounds).catch(() => null) : Promise.resolve(null),
      params.useClutter ? buildLandcover(bounds).catch(() => null) : Promise.resolve(null),
    ]);
    dem = d;
    landcover = lc;
  }

  const classes = new Uint8Array(cols * rows);
  const lngSpan = east - west;
  const latSpan = north - south;
  const reportEvery = Math.max(1, Math.floor(rows / 40));

  const txHeight = params.txHeightM ?? 10;
  const rxHeight = params.rxHeightM ?? 1.5;
  const txGround = dem ? dem.sample(tx.lng, tx.lat) : 0;
  const txElev = txGround + txHeight;

  let inAoiCount = 0;
  let coveredInAoiCount = 0;

  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * latSpan;
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * lngSpan;
      const dist = haversineM(tx.lat, tx.lng, lat, lng);

      let diffraction = 0;
      if (dem && dist > 50) {
        const rxElev = dem.sample(lng, lat) + rxHeight;
        diffraction = deygoutLossDb(buildProfile(tx, { lng, lat }, dist, dem), txElev, rxElev, params.freqMHz, dist);
      }
      const clutterDb = landcover ? clutterDbForClass(landcover.sample(lng, lat)) : params.clutterDb || 0;
      const dbm = receivedDbm(params, dist, diffraction, clutterDb);
      const cls = classifyDbm(dbm, thresholds, floorDbm);
      classes[rowOff + c] = cls;
      if (aoi && inAoi(aoi, lng, lat)) {
        inAoiCount += 1;
        if (cls <= 2) coveredInAoiCount += 1; // excellent/good/marginal = usable
      }
    }
    if (r % reportEvery === 0 || r === rows - 1) {
      self.postMessage({ type: 'progress', id, done: r + 1, total: rows, phase: 'compute' });
    }
  }

  self.postMessage(
    {
      type: 'done', id, cols, rows, classes,
      terrain: !!dem, clutter: !!landcover,
      totalCells: cols * rows,
      inAoi: aoi ? inAoiCount : null,
      coveredInAoi: aoi ? coveredInAoiCount : null,
      coveredFracAoi: aoi && inAoiCount ? coveredInAoiCount / inAoiCount : null,
    },
    [classes.buffer],
  );
};

/** Is (lng, lat) inside the AOI shape? Radius → distance; polygon → ray-cast. */
function inAoi(aoi, lng, lat) {
  if (aoi.type === 'radius') {
    return haversineM(aoi.center.lat, aoi.center.lng, lat, lng) <= aoi.radiusM;
  }
  return pointInRing(aoi.ring, lng, lat);
}

/** Ray-casting point-in-polygon against a ring of [lng, lat] pairs. */
function pointInRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
