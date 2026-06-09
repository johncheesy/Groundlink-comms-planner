/**
 * M9 — Cellular connectivity layer.
 *
 * Models cellular (2G/3G/4G/5G) coverage from cell-tower locations through the
 * SAME terrain engine the RF coverage uses (FSPL + Deygout in the coverage
 * worker) — not a third-party coverage overlay. Towers come from a shipped
 * OpenCelliD snapshot (CC BY-SA 4.0), so there is no runtime key.
 *
 * The pure parts (band presets, macro defaults, tower selection) are unit-
 * tested; the controller wraps a dedicated coverage instance painted on its own
 * map layer, independent of the mission radio coverage.
 *
 * Honesty: OpenCelliD is crowdsourced; cells are really sectorised + downtilted
 * and this models them as omni transmitters — planning-grade, not an operator
 * map. See docs/M9-connectivity-layers.md.
 */

// Band → frequency presets (user-selectable, editable). MHz drives FSPL.
export const CELL_BANDS = [
  { key: 'n28-700', label: '5G low (n28)', freqMHz: 700, note: 'wide rural reach' },
  { key: 'b20-800', label: 'LTE B20', freqMHz: 800, note: 'rural / in-building' },
  { key: 'b8-900', label: '900 (GSM/B8)', freqMHz: 900, note: 'legacy 2G/3G' },
  { key: 'b3-1800', label: '1800 (B3)', freqMHz: 1800, note: 'capacity' },
  { key: 'b1-2100', label: '2100 (B1)', freqMHz: 2100, note: '3G/4G urban' },
  { key: 'b7-2600', label: '2600 (B7)', freqMHz: 2600, note: 'urban capacity' },
  { key: 'n78-3500', label: '5G mid (n78)', freqMHz: 3500, note: 'dense urban, short' },
];

// OpenCelliD `radio` values, mapped to the operator-facing generation label.
export const RADIO_TYPES = [
  { key: 'GSM', label: '2G · GSM' },
  { key: 'UMTS', label: '3G · UMTS' },
  { key: 'LTE', label: '4G · LTE' },
  { key: 'NR', label: '5G · NR' },
];

// Macro-cell defaults (editable). Downlink-style: the binding link is tower→device.
// EIRP ≈ +58 dBm omni approximation of a few hundred W ERP per sector.
export const CELL_DEFAULTS = Object.freeze({
  eirpDbm: 58,
  txHeightM: 30,
  rxHeightM: 1.5,
  rxSensDbm: -100, // LTE reference
});

/** A band preset by key (falls back to 2100 B1). */
export function bandPreset(key) {
  return CELL_BANDS.find((b) => b.key === key) || CELL_BANDS.find((b) => b.key === 'b1-2100');
}

/** A shallow copy of the macro defaults for UI seeding. */
export function cellDefaults() {
  return { ...CELL_DEFAULTS };
}

/**
 * Select towers for a compute run: filter by radio type + bounding box, sort by
 * proximity to the viewport centre, and cap to `maxN` to stay responsive.
 * Pure — no map, no fetch.
 *
 * @param {Array<{lat:number, lon:number, radio:string}>} cells
 * @param {{radio?:string|null, bbox?:{west,south,east,north}|null, center?:{lat,lng}|null, maxN?:number}} opts
 */
export function selectTowers(cells = [], { radio = null, bbox = null, center = null, maxN = 80 } = {}) {
  let list = (cells || []).filter(Boolean);
  if (radio) list = list.filter((c) => c.radio === radio);
  if (bbox) list = list.filter((c) => inBbox(c, bbox));
  if (center) list = list.slice().sort((a, b) => dist2(a, center) - dist2(b, center));
  if (Number.isFinite(maxN) && maxN > 0 && list.length > maxN) list = list.slice(0, maxN);
  return list;
}

/** Map snapshot towers to the worker's tx shape ({lat, lng, txHeightM}). */
export function towersToTxs(towers = [], txHeightM = CELL_DEFAULTS.txHeightM) {
  return (towers || []).map((t) => ({ lat: t.lat, lng: t.lon, txHeightM }));
}

/** Signal thresholds (dBm) derived from a device RX sensitivity. */
export function thresholdsForSensitivity(rxSensDbm = CELL_DEFAULTS.rxSensDbm) {
  const s = Number.isFinite(rxSensDbm) ? rxSensDbm : CELL_DEFAULTS.rxSensDbm;
  return { excellent: s + 25, good: s + 15, marginal: s + 5, none: s };
}

function inBbox(c, b) {
  return c.lat >= b.south && c.lat <= b.north && c.lon >= b.west && c.lon <= b.east;
}
function dist2(c, ctr) {
  const dx = c.lon - ctr.lng;
  const dy = c.lat - ctr.lat;
  return dx * dx + dy * dy;
}

// ── Controller (main thread; wraps a dedicated coverage instance) ───────────

/**
 * @param {maplibregl.Map} map
 * @param {ReturnType<import('../coverage/coverage.js').createCoverageController>} coverage
 *        a coverage controller bound to the 'cellular' source/layer
 * @param {{onStatus?:Function, cellularLayerId?:string}} opts
 */
export function createCellularController(map, coverage, { onStatus, cellularLayerId = 'cellular-layer' } = {}) {
  let cells = [];
  let meta = { region: null, attribution: null, generated: null };
  let lastCount = 0;

  async function load(file = 'nl') {
    const url = `${import.meta.env.BASE_URL}cells/${file}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cells ${file}: ${res.status}`);
    const data = await res.json();
    cells = Array.isArray(data.cells) ? data.cells : [];
    meta = {
      region: data.region ?? file,
      attribution: data.attribution ?? 'OpenCelliD (CC BY-SA 4.0)',
      generated: data.generated ?? null,
    };
    return { count: cells.length, ...meta };
  }

  function viewportBbox() {
    const b = map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  /**
   * Run a cellular coverage compute over the current viewport.
   * @param {{radio, freqMHz, eirpDbm, txHeightM, rxHeightM?, rxSensDbm?, useTerrain?, useClutter?, maxN?}} o
   */
  function compute(o = {}) {
    const bbox = viewportBbox();
    const c = map.getCenter();
    const center = { lat: c.lat, lng: c.lng };
    const towers = selectTowers(cells, { radio: o.radio ?? null, bbox, center, maxN: o.maxN ?? 80 });
    lastCount = towers.length;
    if (!towers.length) {
      onStatus?.('empty', { count: 0 });
      return { count: 0 };
    }
    const txHeightM = num(o.txHeightM, CELL_DEFAULTS.txHeightM);
    const params = {
      eirpDbm: num(o.eirpDbm, CELL_DEFAULTS.eirpDbm),
      freqMHz: num(o.freqMHz, 2100),
      rxGainDbi: 0,
      clutterDb: 0,
      thresholds: thresholdsForSensitivity(o.rxSensDbm),
      floorDbm: num(o.rxSensDbm, CELL_DEFAULTS.rxSensDbm) - 10,
      useTerrain: !!o.useTerrain,
      useClutter: !!o.useClutter,
      txHeightM,
      rxHeightM: num(o.rxHeightM, CELL_DEFAULTS.rxHeightM),
    };
    coverage.compute(bbox, center, params, { txs: towersToTxs(towers, txHeightM), marker: false });
    onStatus?.('computing', { count: towers.length });
    return { count: towers.length };
  }

  function setVisible(on) {
    if (map.getLayer(cellularLayerId)) {
      map.setLayoutProperty(cellularLayerId, 'visibility', on ? 'visible' : 'none');
    }
  }

  function clear() {
    coverage.clear();
    lastCount = 0;
  }

  return {
    load,
    compute,
    setVisible,
    clear,
    getCount: () => lastCount,
    getMeta: () => ({ ...meta }),
    hasData: () => cells.length > 0,
  };
}

const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
