/**
 * Best-server + interference view (M24) — pure raster building, no DOM.
 *
 * The coverage worker already evaluates every transmitter per cell to take the
 * max; when asked (params.collectServer) it also records WHICH site won
 * (`servers`: site index per cell, 255 = below floor) and the margin between
 * the best and second-best signal (`marginQ`: quarter-dB, 254 cap, 255 = only
 * one site reaches the cell). This module turns those two arrays into the
 * operator-style zone raster: cells colour by winning site, and — when the
 * interference view is on — cells where the top two sites sit within the
 * threshold paint as the contested band instead (co-channel interference /
 * handover zone candidate).
 *
 * Planning-grade, same caveats as the underlying engine. Pure functions only —
 * shared by the controller and the unit tests.
 */

/** No-site marker in the servers array (below floor / clipped). */
export const NO_SERVER = 255;
/** Margin value meaning "only one site reaches this cell". */
export const MARGIN_SINGLE = 255;
/** Default contested-overlap threshold (dB): top two sites within this. */
export const DEFAULT_INTERFERENCE_DB = 6;

/** dB → quarter-dB byte (0–254; 255 is reserved for "single source"). */
export const quantizeMarginDb = (db) => Math.max(0, Math.min(254, Math.round(db * 4)));
/** quarter-dB byte → dB. */
export const dequantizeMargin = (q) => q / 4;

/**
 * Categorical site palette — resolved from the --srv-* tokens by the caller
 * (controller passes resolved [r,g,b] triplets); these literals are the
 * token fallbacks for worker/test contexts. Cycles past 8 sites.
 */
export const SERVER_PALETTE_FALLBACK = [
  [0x46, 0xa6, 0xff], // azure
  [0x34, 0xe6, 0xc2], // teal
  [0xff, 0xd4, 0x79], // amber
  [0xff, 0x6b, 0x8a], // rose
  [0x86, 0xe6, 0xa0], // green
  [0xff, 0x9f, 0x7a], // orange
  [0x67, 0xe8, 0xf9], // cyan
  [0xd9, 0xf9, 0x9d], // lime
];
export const CONTEST_FALLBACK = [0xf4, 0xf4, 0xf5];

/**
 * Build the RGBA image + per-site stats for the best-server view.
 *
 * @param {Uint8Array} servers  winning site index per cell (255 = none)
 * @param {Uint8Array} marginQ  best-vs-second margin, quarter-dB (255 = single)
 * @param {object} [o]
 * @param {Array<[number,number,number]>} [o.palette]  site colours (cycled)
 * @param {boolean} [o.interference=false]  paint the contested band
 * @param {number}  [o.thresholdDb=6]       contested when margin ≤ this
 * @param {[number,number,number]} [o.contestColor]
 * @returns {{ data: Uint8ClampedArray, counts: number[], contested: number, covered: number }}
 *   counts[i] = cells won by site i (contested cells still count for their
 *   winner so zone shares stay meaningful); `contested` = cells in the band.
 */
export function buildServerImage(servers, marginQ, {
  palette = SERVER_PALETTE_FALLBACK,
  interference = false,
  thresholdDb = DEFAULT_INTERFERENCE_DB,
  contestColor = CONTEST_FALLBACK,
} = {}) {
  const n = servers.length;
  const data = new Uint8ClampedArray(n * 4);
  const counts = [];
  let contested = 0;
  let covered = 0;
  const thrQ = quantizeMarginDb(thresholdDb);
  for (let i = 0; i < n; i++) {
    const s = servers[i];
    const o = i * 4;
    if (s === NO_SERVER) {
      data[o + 3] = 0;
      continue;
    }
    covered += 1;
    counts[s] = (counts[s] ?? 0) + 1;
    const isContested = interference && marginQ[i] !== MARGIN_SINGLE && marginQ[i] <= thrQ;
    if (isContested) contested += 1;
    const [r, g, b] = isContested ? contestColor : palette[s % palette.length];
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = isContested ? 235 : 255;
  }
  for (let i = 0; i < counts.length; i++) counts[i] = counts[i] ?? 0;
  return { data, counts, contested, covered };
}

/**
 * Legend rows for the painted zones: one per site that actually won cells,
 * ordered by share, plus a contested row when the band is shown.
 * @returns {Array<{index:number, name:string, frac:number, cells:number}>}
 */
export function serverLegend(counts, covered, names = []) {
  const rows = counts
    .map((cells, index) => ({ index, cells, name: names[index] || `Site ${index + 1}`, frac: covered ? cells / covered : 0 }))
    .filter((r) => r.cells > 0);
  rows.sort((a, b) => b.cells - a.cells);
  return rows;
}
