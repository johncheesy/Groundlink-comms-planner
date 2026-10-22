/**
 * What a coverage result rests on, in words a user can check.
 *
 * "100% covered" is only meaningful next to the frequency, power, heights and
 * grid it was computed with, and an unchosen radio silently falls back to
 * defaults. Pure function: main.js passes in the values, the result card
 * renders the output.
 */

export const DEFAULT_FREQ_MHZ = 150;
export const DEFAULT_POWER_W = 5;
/** Grid cells coarser than this average out the terrain detail that causes dead zones. */
export const COARSE_CELL_M = 250;

/** Approx. ground size of one grid cell in metres, from the compute bounds. */
export function cellSizeM(bounds, cols) {
  if (!bounds || !(cols > 0)) return null;
  const midLat = (bounds.north + bounds.south) / 2;
  const widthM = (bounds.east - bounds.west) * 111320 * Math.cos((midLat * Math.PI) / 180);
  const m = widthM / cols;
  return Number.isFinite(m) && m > 0 ? m : null;
}

/**
 * @param {object} p
 * @param {number} p.freqMHz
 * @param {number} p.powerW
 * @param {number} p.txHeightM
 * @param {number} p.rxHeightM
 * @param {boolean} p.terrainUsed     DEM actually used (stats.terrain)
 * @param {boolean} p.clutterRequested user ticked "clutter"
 * @param {boolean} p.clutterUsed      clutter data actually applied (stats.clutter)
 * @param {number|null} p.cellM
 * @param {boolean} p.radioApplied     a radio from the arsenal is active
 * @param {string|null} [p.terrainSource] credit for the elevation data used
 * @returns {{ summary:string, source:'radio'|'defaults'|'manual', warnings:string[] }}
 */
export function describeAssumptions(p) {
  const fmt = (n, d = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(d));
  const parts = [
    `${fmt(p.freqMHz)} MHz`,
    `${fmt(p.powerW, 2)} W`,
    `tx ${fmt(p.txHeightM)} m`,
    `rx ${fmt(p.rxHeightM)} m`,
  ];
  if (p.cellM != null) parts.push(`cell ≈ ${p.cellM >= 1000 ? `${(p.cellM / 1000).toFixed(1)} km` : `${Math.round(p.cellM)} m`}`);
  if (p.terrainSource) parts.push(`terrain: ${p.terrainSource}`);

  const source = p.radioApplied
    ? 'radio'
    : p.freqMHz === DEFAULT_FREQ_MHZ && p.powerW === DEFAULT_POWER_W ? 'defaults' : 'manual';

  const warnings = [];
  if (source === 'defaults') {
    warnings.push(`No radio selected: using default ${DEFAULT_FREQ_MHZ} MHz and ${DEFAULT_POWER_W} W. Pick the radio you carry for a result that means something.`);
  }
  if (!p.terrainUsed) warnings.push('Flat earth: terrain was not used, so hills and ridges are ignored.');
  if (p.clutterRequested && !p.clutterUsed) {
    warnings.push('Clutter was requested but no data was available, so trees and buildings are not modelled.');
  } else if (!p.clutterRequested) {
    warnings.push('Clutter is off: trees and buildings are not modelled, so coverage is optimistic in vegetation and built-up areas.');
  }
  if (p.cellM != null && p.cellM > COARSE_CELL_M) {
    warnings.push(`Coarse grid (about ${Math.round(p.cellM)} m per cell): narrow valleys and ridge shadows can be missed.`);
  }
  return { summary: parts.join(' · '), source, warnings };
}
