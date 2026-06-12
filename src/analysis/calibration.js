/**
 * M27 — Field calibration from measured RSSI (pure logic).
 *
 * Import a CSV of field measurements (lat, lon, dBm, radio_id), predict the
 * model's level at each point with the SAME math the coverage worker runs
 * (FSPL + Deygout over the DEM — the fallback engine; P.1812 percentile runs
 * are out of scope for v1 and noted in the doc), and fit one linear bias per
 * radio: offset = mean(measured − predicted). Applying the offset shifts that
 * radio's link budget — it corrects systematic error (antenna gains, cable
 * loss, clutter the model can't see), not terrain shape.
 *
 * Everything here is pure and unit-tested; map dots and the apply/persist
 * flow live in main.js. Honesty: a constant offset is the simplest defensible
 * correction — it cannot fix geometry errors, and the export records n /
 * spread so a 3-point "calibration" is visibly weak.
 */

import { receivedDbm, deygoutLossDb, haversineM } from '../coverage/model.js';
import { buildProfile } from '../workers/profile.js';

/** Hard cap on imported rows — keeps point-wise prediction interactive. */
export const MAX_POINTS = 2000;

// Header aliases, lower-cased and stripped of spaces/underscores.
const HEADER_ALIASES = {
  lat: 'lat', latitude: 'lat',
  lon: 'lon', lng: 'lon', long: 'lon', longitude: 'lon',
  dbm: 'dbm', rssi: 'dbm', signaldbm: 'dbm', rssidbm: 'dbm', signal: 'dbm',
  radioid: 'radioId', radio: 'radioId', radioname: 'radioId',
};

/** Split one CSV line, honouring double-quoted fields (RFC 4180 subset). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse a measurements CSV. Requires a header row containing at least
 * lat/lon/dBm columns (aliases above); radio_id is optional — rows without it
 * fit under the null radio bucket.
 *
 * @returns {{ points: Array<{lat:number, lon:number, dBm:number, radioId:string|null}>,
 *             skipped: number, error: string|null }}
 */
export function parseRssiCsv(text) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { points: [], skipped: 0, error: 'CSV needs a header row plus at least one data row.' };

  const header = splitCsvLine(lines[0]).map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s_-]/g, '')] ?? null);
  const idx = { lat: header.indexOf('lat'), lon: header.indexOf('lon'), dbm: header.indexOf('dbm'), radioId: header.indexOf('radioId') };
  if (idx.lat < 0 || idx.lon < 0 || idx.dbm < 0) {
    return { points: [], skipped: 0, error: 'Header must include lat, lon and dBm columns (aliases: latitude, lng/longitude, rssi/signal_dbm).' };
  }

  const points = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    if (points.length >= MAX_POINTS) { skipped += lines.length - i; break; }
    const cells = splitCsvLine(lines[i]);
    const lat = Number(cells[idx.lat]);
    const lon = Number(cells[idx.lon]);
    const dBm = Number(cells[idx.dbm]);
    const valid =
      Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
      Number.isFinite(dBm) && dBm <= 0 && dBm >= -160;
    if (!valid) { skipped++; continue; }
    const radioId = idx.radioId >= 0 ? (cells[idx.radioId] ?? '').trim() || null : null;
    points.push({ lat, lon, dBm, radioId });
  }
  return { points, skipped, error: points.length ? null : 'No valid rows — check lat/lon/dBm value ranges.' };
}

/**
 * Predict the model's received level (dBm) at one point — the worker's
 * FSPL+Deygout cell math for a list of transmitters, strongest wins.
 *
 * @param {{lat:number, lon:number}} pt
 * @param {Array<{lat:number, lng:number, txHeightM:number}>} txs
 * @param {{eirpDbm, freqMHz, rxGainDbi?, clutterDb?, rxHeightM?}} params
 * @param {{sample:(lng,lat)=>number}|null} dem  null → flat FSPL
 */
export function predictDbm(pt, txs, params, dem) {
  const rxElev = (dem ? dem.sample(pt.lon, pt.lat) : 0) + (params.rxHeightM ?? 1.5);
  let best = -Infinity;
  for (const t of txs) {
    const dist = haversineM(t.lat, t.lng, pt.lat, pt.lon);
    let diffraction = 0;
    if (dem && dist > 50) {
      const txElev = dem.sample(t.lng, t.lat) + (t.txHeightM ?? 10);
      diffraction = deygoutLossDb(
        buildProfile(t, { lng: pt.lon, lat: pt.lat }, dist, dem),
        txElev, rxElev, params.freqMHz, dist,
      );
    }
    const dbm = receivedDbm(params, dist, diffraction, params.clutterDb || 0);
    if (dbm > best) best = dbm;
  }
  return best;
}

/**
 * Fit per-radio linear bias from measured-vs-predicted samples.
 * delta = measured − predicted; offset = mean(delta) per radioId.
 *
 * @param {Array<{radioId:string|null, measuredDbm:number, predictedDbm:number}>} samples
 * @returns {Array<{radioId:string|null, n:number, offsetDb:number,
 *                  rmseBefore:number, rmseAfter:number, sdDelta:number}>}
 *          sorted by n descending; numbers rounded to 0.1 dB.
 */
export function fitCalibration(samples) {
  const byRadio = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s.measuredDbm) || !Number.isFinite(s.predictedDbm)) continue;
    const key = s.radioId ?? null;
    if (!byRadio.has(key)) byRadio.set(key, []);
    byRadio.get(key).push(s.measuredDbm - s.predictedDbm);
  }
  const round1 = (v) => Math.round(v * 10) / 10;
  const fits = [];
  for (const [radioId, deltas] of byRadio) {
    const n = deltas.length;
    const mean = deltas.reduce((a, d) => a + d, 0) / n;
    const rmse = (arr) => Math.sqrt(arr.reduce((a, d) => a + d * d, 0) / arr.length);
    const sd = Math.sqrt(deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / n);
    fits.push({
      radioId,
      n,
      offsetDb: round1(mean),
      rmseBefore: round1(rmse(deltas)),
      rmseAfter: round1(rmse(deltas.map((d) => d - mean))),
      sdDelta: round1(sd),
    });
  }
  return fits.sort((a, b) => b.n - a.n);
}

/**
 * Deviation bucket for the map dots: model-conservative (measured stronger),
 * agreeing (within ±3 dB), or model-optimistic (measured weaker — the
 * dangerous direction for planning).
 */
export function deviationBucket(deltaDb) {
  if (deltaDb > 3) return 'conservative';
  if (deltaDb < -3) return 'optimistic';
  return 'agree';
}

/**
 * Serializable calibration file (the "calibrated model" export): the fitted
 * offsets plus enough context to audit them. No coordinates are included —
 * only aggregate statistics (OPSEC: measurement positions stay local).
 */
export function calibrationFile(fits, { engine = 'fspl-deygout', generated = null } = {}) {
  return {
    format: 'groundlink-calibration',
    version: 1,
    engine,
    generated,
    radios: fits.map((f) => ({
      radioId: f.radioId,
      offsetDb: f.offsetDb,
      n: f.n,
      rmseBeforeDb: f.rmseBefore,
      rmseAfterDb: f.rmseAfter,
      sdDeltaDb: f.sdDelta,
    })),
  };
}
