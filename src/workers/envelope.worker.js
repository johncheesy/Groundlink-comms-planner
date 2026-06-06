/**
 * M2.1 (B) — Flight / link envelope worker.
 *
 * From a ground station X, compute where a drone can fly and keep its link, per
 * altitude band (AGL). A pixel is reachable at a band if (a) terrain
 * line-of-sight from the GCS antenna to the drone at that altitude is clear
 * (k=4/3 earth bulge), and (b) the C2 link budget closes (FSPL ≥ sensitivity,
 * air link → no clutter). Returns the lowest band that works (nested zones);
 * pixels in link range but terrain-blocked at every band are flagged as shadow.
 *
 * Classes: 0..bands.length-1 = reachable at that band (0 = lowest/innermost),
 *          250 = terrain shadow (in range, blocked), 255 = out of link range.
 */
import { buildDem } from './dem.js';
import { fsplDb, earthBulgeM, haversineM } from '../coverage/model.js';

export const ENVELOPE_SHADOW = 250;
export const ENVELOPE_NONE = 255;

self.onmessage = async (e) => {
  const m = e.data;
  if (m?.type !== 'envelope') return;
  const { id, bounds, cols, rows, gcs, gcsHeightM, bands, freqMHz, eirpDbm, rxSensDbm } = m;

  self.postMessage({ type: 'progress', id, done: 0, total: rows, phase: 'data' });
  const dem = await buildDem(bounds).catch(() => null);

  const classes = new Uint8Array(cols * rows).fill(ENVELOPE_NONE);
  const { west, south, east, north } = bounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  const gcsElev = (dem ? dem.sample(gcs.lng, gcs.lat) : 0) + gcsHeightM;
  const reportEvery = Math.max(1, Math.floor(rows / 40));

  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * latSpan;
    const off = r * cols;
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * lngSpan;
      const dist = haversineM(gcs.lat, gcs.lng, lat, lng);
      if (dist < 1) continue;
      // C2 link budget (air link, no clutter): received at drone ≥ sensitivity.
      if (eirpDbm - fsplDb(dist, freqMHz) < rxSensDbm) continue; // out of range → NONE
      const ground = dem ? dem.sample(lng, lat) : 0;
      let cls = ENVELOPE_SHADOW; // in range; assume blocked until a band clears
      for (let bi = 0; bi < bands.length; bi++) {
        if (losClear(gcs, lng, lat, dist, gcsElev, ground + bands[bi], dem)) {
          cls = bi;
          break;
        }
      }
      classes[off + c] = cls;
    }
    if (r % reportEvery === 0 || r === rows - 1) {
      self.postMessage({ type: 'progress', id, done: r + 1, total: rows, phase: 'compute' });
    }
  }

  self.postMessage({ type: 'done', id, cols, rows, classes, terrain: !!dem }, [classes.buffer]);
};

/** Terrain line-of-sight from GCS antenna to the drone point at target altitude. */
function losClear(gcs, lng, lat, dist, gcsElev, targetElev, dem) {
  if (!dem) return true; // no terrain → flat → always LOS
  const n = Math.max(8, Math.min(40, Math.round(dist / 1500)));
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const d1 = f * dist;
    const terr = dem.sample(gcs.lng + (lng - gcs.lng) * f, gcs.lat + (lat - gcs.lat) * f) + earthBulgeM(d1, dist - d1);
    const chord = gcsElev + (targetElev - gcsElev) * f;
    if (terr > chord) return false; // terrain pierces the sight line
  }
  return true;
}
