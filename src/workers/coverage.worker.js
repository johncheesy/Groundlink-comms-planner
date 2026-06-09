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
import { createYielder } from './yield.js';

// Cancellation: `activeId` is the only job allowed to finish. A newer 'compute'
// bumps it; a 'cancel' (posted by the controller's clear()) sets `cancelled`.
// The sweep yields every chunk so these messages are actually delivered, then
// early-exits — a superseded job no longer runs to completion. See ./yield.js.
let activeId = 0;
let cancelled = false;
const yieldToEventLoop = createYielder();

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg?.type === 'cancel') { cancelled = true; return; }
  if (msg?.type !== 'compute') return;
  const { id, bounds, cols, rows, tx, params, aoi, clipToAoi } = msg;
  activeId = id;
  cancelled = false;
  const aborted = () => id !== activeId || cancelled;
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
    if (aborted()) return; // superseded/cancelled while fetching tiles
  }

  const classes = new Uint8Array(cols * rows);
  const lngSpan = east - west;
  const latSpan = north - south;
  const reportEvery = Math.max(1, Math.floor(rows / 40));
  // Yield ~12 times across the sweep so a newer compute / cancel can abort us.
  const yieldEvery = Math.max(1, Math.floor(rows / 12));

  const rxHeight = params.rxHeightM ?? 1.5;

  // Transmitter list. Single `tx` is always accepted (backward compatible);
  // when `txs` is supplied (M3 multi-site) each cell takes the strongest of all
  // transmitters. A 1-element list reproduces the single-tx result exactly.
  const txList = msg.txs?.length
    ? msg.txs
    : [{ lat: tx.lat, lng: tx.lng, txHeightM: params.txHeightM ?? 10 }];
  const txElevs = txList.map((t) => (dem ? dem.sample(t.lng, t.lat) : 0) + (t.txHeightM ?? 10));

  let inAoiCount = 0;
  let coveredInAoiCount = 0;

  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * latSpan;
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * lngSpan;
      // Clip to AOI — mark cells outside the drawn shape as transparent and skip
      // the expensive compute. Enabled when `clipToAoi` is set (cellular layers).
      if (clipToAoi && aoi && !inAoi(aoi, lng, lat)) {
        classes[rowOff + c] = 255; // COVERAGE_CLASS.TRANSPARENT
        continue;
      }
      // Rx-side terms depend only on the cell, not the transmitter.
      const rxElev = (dem ? dem.sample(lng, lat) : 0) + rxHeight;
      const clutterDb = landcover ? clutterDbForClass(landcover.sample(lng, lat)) : params.clutterDb || 0;

      let maxDbm = -Infinity;
      for (let ti = 0; ti < txList.length; ti++) {
        const t = txList[ti];
        const dist = haversineM(t.lat, t.lng, lat, lng);
        let diffraction = 0;
        if (dem && dist > 50) {
          diffraction = deygoutLossDb(buildProfile(t, { lng, lat }, dist, dem), txElevs[ti], rxElev, params.freqMHz, dist);
        }
        const dbm = receivedDbm(params, dist, diffraction, clutterDb);
        if (dbm > maxDbm) maxDbm = dbm;
      }
      const cls = classifyDbm(maxDbm, thresholds, floorDbm);
      classes[rowOff + c] = cls;
      if (aoi && inAoi(aoi, lng, lat)) {
        inAoiCount += 1;
        if (cls <= 2) coveredInAoiCount += 1; // excellent/good/marginal = usable
      }
    }
    if (r % reportEvery === 0 || r === rows - 1) {
      self.postMessage({ type: 'progress', id, done: r + 1, total: rows, phase: 'compute' });
    }
    if ((r + 1) % yieldEvery === 0 && r < rows - 1) {
      await yieldToEventLoop();
      if (aborted()) return; // a newer job took over (or clear() cancelled) — stop
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
