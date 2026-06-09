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

// Per-generation defaults used by the "Show coverage" flow: the sensible band
// frequency (from CELL_BANDS) plus the map layer colour. Frequency drives FSPL,
// EIRP/height/sensitivity stay on the macro defaults above (not user-exposed).
export const CELL_TYPE_DEFAULTS = Object.freeze({
  GSM:  { freqMHz: 900,  color: '#94a3b8', label: '2G · GSM' },  // grey
  UMTS: { freqMHz: 900,  color: '#fbbf24', label: '3G · UMTS' }, // amber
  LTE:  { freqMHz: 800,  color: '#46a6ff', label: '4G · LTE' },  // azure
  NR:   { freqMHz: 3500, color: '#34e6c2', label: '5G · NR' },   // teal
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

const CELL_ORDER = ['GSM', 'UMTS', 'LTE', 'NR'];

// Overpass API endpoint — free, no key, global OSM tower data.
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

/**
 * Infer the network type (GSM/UMTS/LTE/NR) from an OSM node's tags.
 * Falls back to 'LTE' (most common macro) when no tag matches.
 */
function inferRadioTypeFromTags(tags) {
  if (!tags) return 'LTE';
  if (tags['communication:nr'] === 'yes' || tags['communication:5g'] === 'yes') return 'NR';
  if (tags['communication:lte'] === 'yes' || tags['communication:4g'] === 'yes') return 'LTE';
  if (tags['communication:umts'] === 'yes' || tags['communication:3g'] === 'yes') return 'UMTS';
  if (tags['communication:gsm'] === 'yes' || tags['communication:2g'] === 'yes') return 'GSM';
  // operator tag + generation patterns
  const op = (tags.operator || '').toLowerCase();
  if (/5g|nr/.test(op)) return 'NR';
  if (/lte|4g/.test(op)) return 'LTE';
  if (/umts|3g/.test(op)) return 'UMTS';
  if (/gsm|2g/.test(op)) return 'GSM';
  return 'LTE'; // default: LTE macro cell
}

/**
 * Fetch cell-tower nodes from OSM via Overpass API for the given bounding box.
 * Returns an array of { lat, lon, radio } objects compatible with selectTowers().
 */
async function fetchTowersFromOSM(bbox) {
  const { south, west, north, east } = bbox;
  // Three node selectors that cover most macro-cell towers in OSM tagging practice:
  //   1. communication:mobile_phone=yes  (common general tag)
  //   2. tower:type=communication        (structural tag)
  //   3. man_made=mast + communication:* (masts explicitly tagged with any network)
  const query =
    `[out:json][timeout:25];(` +
    `node["communication:mobile_phone"="yes"](${south},${west},${north},${east});` +
    `node["tower:type"="communication"](${south},${west},${north},${east});` +
    `node["man_made"="mast"]["communication:mobile_phone"](${south},${west},${north},${east});` +
    `);out body;`;
  const res = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass API ${res.status} ${res.statusText}`);
  const data = await res.json();
  // Deduplicate by lat/lon (some nodes match multiple selectors)
  const seen = new Set();
  const towers = [];
  for (const el of (data.elements || [])) {
    const key = `${el.lat},${el.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    towers.push({ lat: el.lat, lon: el.lon, radio: inferRadioTypeFromTags(el.tags) });
  }
  return towers;
}

/** True if two bboxes differ by more than ~10 km in any direction. */
function bboxChangedSignificantly(a, b) {
  return (
    Math.abs(a.west - b.west) > 0.1 ||
    Math.abs(a.east - b.east) > 0.1 ||
    Math.abs(a.south - b.south) > 0.1 ||
    Math.abs(a.north - b.north) > 0.1
  );
}

/**
 * @param {maplibregl.Map} map
 * @param {Record<'GSM'|'UMTS'|'LTE'|'NR', ReturnType<import('../coverage/coverage.js').createCoverageController>>} coverages
 *        one coverage controller per network type, each on its own coloured layer
 * @param {{onStatus?:Function}} opts
 */
export function createCellularController(map, coverages, { onStatus } = {}) {
  let cachedTowers = [];
  let cachedBbox = null;
  let lastCount = 0;
  const meta = {
    region: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors (ODbL) · Overpass API',
    generated: null,
  };

  function viewportBbox() {
    const b = map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  function computeType(type, bbox, center, o) {
    const cov = coverages[type];
    const def = CELL_TYPE_DEFAULTS[type];
    if (!cov || !def) return 0;
    const towers = selectTowers(cachedTowers, { radio: type, bbox, center, maxN: o.maxN ?? 80 });
    if (!towers.length) { cov.clear(); return 0; }
    const txHeightM = CELL_DEFAULTS.txHeightM;
    const params = {
      eirpDbm: CELL_DEFAULTS.eirpDbm,
      freqMHz: def.freqMHz,
      rxGainDbi: 0,
      clutterDb: 0,
      thresholds: thresholdsForSensitivity(CELL_DEFAULTS.rxSensDbm),
      floorDbm: CELL_DEFAULTS.rxSensDbm - 10,
      useTerrain: !!o.useTerrain,
      useClutter: !!o.useClutter,
      txHeightM,
      rxHeightM: CELL_DEFAULTS.rxHeightM,
    };
    cov.compute(bbox, center, params, { txs: towersToTxs(towers, txHeightM), marker: false });
    return towers.length;
  }

  /**
   * Fetch towers from Overpass (if needed) then paint coverage for each
   * checked network type on its own coloured layer. Now async.
   * @param {Array<'GSM'|'UMTS'|'LTE'|'NR'>} types
   * @param {{useTerrain?:boolean, useClutter?:boolean, maxN?:number}} o
   */
  async function showCoverage(types = [], o = {}) {
    const bbox = viewportBbox();

    // Re-fetch if we have no data or the viewport has moved significantly
    if (!cachedBbox || bboxChangedSignificantly(cachedBbox, bbox)) {
      onStatus?.('loading', { count: 0, totals: {} });
      try {
        cachedTowers = await fetchTowersFromOSM(bbox);
        cachedBbox = bbox;
        meta.generated = new Date().toISOString();
      } catch (err) {
        onStatus?.('error', { message: err.message });
        return { count: 0, totals: {} };
      }
    }

    const want = new Set(types);
    const c = map.getCenter();
    const center = { lat: c.lat, lng: c.lng };
    const totals = {};
    let grand = 0;
    for (const type of CELL_ORDER) {
      if (!want.has(type)) { coverages[type]?.clear(); totals[type] = 0; continue; }
      const n = computeType(type, bbox, center, o);
      totals[type] = n;
      grand += n;
    }
    lastCount = grand;
    onStatus?.(grand ? 'computing' : 'empty', { count: grand, totals });
    return { count: grand, totals };
  }

  function setVisible(on) {
    for (const type of CELL_ORDER) coverages[type]?.setVisible(on);
  }

  function clear() {
    for (const type of CELL_ORDER) coverages[type]?.clear();
    cachedTowers = [];
    cachedBbox = null;
    lastCount = 0;
  }

  return {
    showCoverage,
    setVisible,
    clear,
    getCount: () => lastCount,
    getMeta: () => ({ ...meta }),
    hasData: () => cachedTowers.length > 0,
  };
}
