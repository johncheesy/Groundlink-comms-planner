/**
 * Field validation — how well each coverage model predicted real
 * measurements (validation page, part 2).
 *
 * Takes the M27 measurement points (lat, lon, dBm), predicts each one with the
 * exact per-cell step the coverage map runs (src/coverage/cell.js) under four
 * model set-ups, and scores the error. Error = predicted − measured (dB):
 * positive means the map promised more signal than was really there — the
 * dangerous direction for planning.
 *
 * The exportable summary carries statistics only, never coordinates
 * (OPSEC): it is what can be published on the validation page.
 *
 * Pure functions; the DOM and the data loading live in main.js.
 */

import { bestDbmAt } from '../coverage/cell.js';
import { haversineM } from '../coverage/model.js';

export const FIELD_ENGINES = Object.freeze([
  { id: 'p1812-clutter', label: 'P.1812 with clutter', engine: 'p1812', useClutter: true },
  { id: 'p1812', label: 'P.1812 without clutter', engine: 'p1812', useClutter: false },
  { id: 'deygout-clutter', label: 'FSPL + Deygout with clutter', engine: 'fallback', useClutter: true },
  { id: 'deygout', label: 'FSPL + Deygout without clutter', engine: 'fallback', useClutter: false },
]);

/** Errors within this many dB count as a hit (typical planning tolerance). */
export const HIT_DB = 6;

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Error statistics for a list of errors (predicted − measured, dB).
 * @returns {{ n, biasDb, rmseDb, sdDb, withinPct, optimisticPct }}
 */
export function errorStats(errors) {
  const v = errors.filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n: 0, biasDb: null, rmseDb: null, sdDb: null, withinPct: null, optimisticPct: null };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const rmse = Math.sqrt(v.reduce((s, x) => s + x * x, 0) / n);
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    biasDb: r1(mean),
    rmseDb: r1(rmse),
    sdDb: r1(sd),
    withinPct: Math.round((100 * v.filter((x) => Math.abs(x) <= HIT_DB).length) / n),
    optimisticPct: Math.round((100 * v.filter((x) => x > HIT_DB).length) / n),
  };
}

/**
 * Score every model set-up against the measurements.
 *
 * @param {Array<{lat:number, lon:number, dBm:number}>} points
 * @param {Array} txs        coverage transmitters (as the map run uses them)
 * @param {object} params    coverage params of the current run
 * @param {{dem?:object|null, clutter?:object|null}} data
 * @returns {Array<{ id, label, stats, errors:number[] }>}
 */
export function compareEngines(points, txs, params, { dem = null, clutter = null } = {}) {
  return FIELD_ENGINES.map((e) => {
    const p = { ...params, engine: e.engine, useClutter: e.useClutter };
    const errors = points.map((pt) =>
      bestDbmAt(pt.lon, pt.lat, { txs, params: p, dem, clutter: e.useClutter ? clutter : null }) - pt.dBm);
    // Without a DEM, P.1812 cannot run (the map falls back to FSPL too).
    const usable = e.engine !== 'p1812' || !!dem;
    const stats = usable ? errorStats(errors) : errorStats([]);
    return { id: e.id, label: e.label, stats, errors: usable ? errors : [] };
  });
}

/** Distance (km) from each point to its nearest transmitter. */
function nearestKm(points, txs) {
  return points.map((pt) => Math.min(...txs.map((t) => haversineM(t.lat, t.lng, pt.lat, pt.lon))) / 1000);
}

/**
 * Publishable summary — statistics and setting, no coordinates. One entry for
 * public/validation/field.json.
 */
export function fieldSummary({ results, points, txs, params, terrain = null, clutter = null, label = '', generated = null }) {
  const km = nearestKm(points, txs).sort((a, b) => a - b);
  const pick = (q) => r1(km[Math.min(km.length - 1, Math.floor(q * km.length))]);
  return {
    format: 'groundlink-field-validation',
    version: 1,
    label: String(label).slice(0, 120),
    generated: generated ?? new Date().toISOString().slice(0, 10),
    setting: {
      freqMHz: params.freqMHz,
      eirpDbm: r1(params.eirpDbm),
      txCount: txs.length,
      txHeightM: params.txHeightM ?? null,
      rxHeightM: params.rxHeightM ?? 1.5,
      terrain,
      clutter,
    },
    points: points.length,
    distanceKm: km.length ? { min: pick(0), median: pick(0.5), max: r1(km[km.length - 1]) } : null,
    engines: results.map(({ id, label: l, stats }) => ({ id, label: l, ...stats })),
  };
}
