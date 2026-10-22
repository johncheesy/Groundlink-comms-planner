/**
 * Coverage grid size: how many cells the worker computes.
 *
 * Before: always 220 cells across the WHOLE compute window. The window reaches
 * out to the radio's range (up to 3x the AOI), so the AOI itself got only about
 * 70 cells across: about 545 m per cell for a 20 km AOI, which averages away the
 * valleys and ridge shadows that cause dead zones.
 *
 * Now: the cell size is set by the AOI (target cells across its larger side),
 * the window around it is filled at the same cell size, and a cell budget
 * keeps compute time bounded. Without an AOI (sites only) the window is the
 * reference, as before. Never coarser than the old grid.
 */

export const DETAIL = Object.freeze({
  // aoiCells: cells across the AOI's larger side; windowCells: when there is no
  // AOI; budget: max total cells (compute time is roughly linear in cells).
  standard: Object.freeze({ aoiCells: 220, windowCells: 220, budget: 140_000 }),
  high: Object.freeze({ aoiCells: 420, windowCells: 420, budget: 420_000 }),
});
export const DETAIL_KEYS = Object.keys(DETAIL);
/** The old grid (220 x 220): never go below it, so no run gets coarser or slower than before. */
export const MIN_BUDGET = 220 * 220;
/** Transmitters the full budget is sized for; beyond this the budget shrinks (work = cells x transmitters). */
const TX_AT_FULL_BUDGET = 3;
const MIN_DIM = 8;
const MAX_DIM = 1400; // canvas/texture safety

const KM_PER_DEG = 111.32;

/** Width and height of a bbox in km (width at its mid latitude). */
export function sizeKm(b) {
  const midLat = (b.north + b.south) / 2;
  return {
    w: Math.abs(b.east - b.west) * KM_PER_DEG * Math.cos((midLat * Math.PI) / 180),
    h: Math.abs(b.north - b.south) * KM_PER_DEG,
  };
}

/** Bounding box of an AOI ring [[lng, lat], ...], or null. */
export function ringBounds(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return Number.isFinite(west) ? { west, east, south, north } : null;
}

/**
 * @param {{west,south,east,north}} bounds   compute window
 * @param {object} [o]
 * @param {{west,south,east,north}|null} [o.aoiBounds]
 * @param {'standard'|'high'} [o.detail]
 * @param {number} [o.txCount]  transmitters in the run; compute time is cells x transmitters
 *   (measured: 10 sites on 140k cells took 9.6 s), so the budget shrinks with
 *   more than a few transmitters, but never below the old 220 x 220 grid.
 * @returns {{ cols:number, rows:number, cellKm:number, capped:boolean, budget:number }}
 */
export function gridDims(bounds, { aoiBounds = null, detail = 'standard', txCount = 1 } = {}) {
  const d = DETAIL[detail] ?? DETAIL.standard;
  const n = Math.max(1, Math.floor(txCount) || 1);
  const budget = Math.max(MIN_BUDGET, Math.round(d.budget * Math.min(1, TX_AT_FULL_BUDGET / n)));
  const win = sizeKm(bounds);
  const winMax = Math.max(win.w, win.h, 1e-6);

  let cell = winMax / d.windowCells; // reference without an AOI (the old rule)
  if (aoiBounds) {
    const a = sizeKm(aoiBounds);
    const aoiMax = Math.max(a.w, a.h);
    if (aoiMax > 0) cell = Math.min(cell, aoiMax / d.aoiCells); // never coarser than before
  }

  let cols = Math.max(MIN_DIM, Math.round(win.w / cell));
  let rows = Math.max(MIN_DIM, Math.round(win.h / cell));
  let capped = false;
  if (cols * rows > budget) {
    const f = Math.sqrt((cols * rows) / budget);
    cols = Math.max(MIN_DIM, Math.floor(cols / f));
    rows = Math.max(MIN_DIM, Math.floor(rows / f));
    capped = true;
  }
  if (cols > MAX_DIM || rows > MAX_DIM) {
    const f = Math.max(cols, rows) / MAX_DIM;
    cols = Math.max(MIN_DIM, Math.floor(cols / f));
    rows = Math.max(MIN_DIM, Math.floor(rows / f));
    capped = true;
  }
  return { cols, rows, cellKm: Math.max(win.w / cols, win.h / rows), capped, budget };
}
