/**
 * Coverage compute Web Worker.
 *
 * Runs the FSPL+Deygout fallback model over a grid covering the AOI bbox, off
 * the main thread so the UI never freezes. Emits progress as it sweeps rows and
 * returns a transferable Uint8Array of class indices (one byte per cell).
 *
 * Grid orientation: row 0 = north edge, col 0 = west edge (matches the way the
 * main thread paints the canvas and places the image overlay over the bbox).
 *
 * Message in:  { type:'compute', id, bounds:{west,south,east,north}, cols, rows,
 *                tx:{lat,lng}, params:{eirpDbm,freqMHz,rxGainDbi,clutterDb,
 *                thresholds,floorDbm} }
 * Messages out:
 *   { type:'progress', id, done, total }
 *   { type:'done', id, cols, rows, classes:Uint8Array (transferred) }
 */
import { receivedDbm, classifyDbm, haversineM } from '../coverage/model.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg?.type !== 'compute') return;
  const { id, bounds, cols, rows, tx, params } = msg;
  const { west, south, east, north } = bounds;

  const classes = new Uint8Array(cols * rows);
  const lngSpan = east - west;
  const latSpan = north - south;

  const thresholds = params.thresholds;
  const floorDbm = params.floorDbm;

  // Sweep rows north→south; report progress every few rows.
  const reportEvery = Math.max(1, Math.floor(rows / 40));
  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * latSpan;
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * lngSpan;
      const dist = haversineM(tx.lat, tx.lng, lat, lng);
      // Flat fallback: diffraction = 0. (Terrain sampler will populate this.)
      const dbm = receivedDbm(params, dist, 0, params.clutterDb || 0);
      classes[rowOff + c] = classifyDbm(dbm, thresholds, floorDbm);
    }
    if (r % reportEvery === 0 || r === rows - 1) {
      self.postMessage({ type: 'progress', id, done: r + 1, total: rows });
    }
  }

  self.postMessage({ type: 'done', id, cols, rows, classes }, [classes.buffer]);
};
