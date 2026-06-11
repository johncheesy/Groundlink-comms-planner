/**
 * M9 — Cellular connectivity layer.
 *
 * Models cellular (2G/3G/4G/5G) coverage from cell-tower locations through the
 * SAME terrain engine the RF coverage uses (FSPL + Deygout in the coverage
 * worker) — not a third-party coverage overlay. Towers are fetched live from
 * OpenStreetMap via the Overpass API (no key needed). A shipped OpenCelliD
 * snapshot pipeline exists (scripts/fetch-opencellid.mjs) but is not wired in
 * yet.
 *
 * The pure parts (band presets, macro defaults, tower selection) are unit-
 * tested; the controller wraps a dedicated coverage instance painted on its own
 * map layer, independent of the mission radio coverage.
 *
 * Honesty: OSM tower data is crowdsourced; cells are really sectorised + downtilted
 * and this models them as omni transmitters — planning-grade, not an operator
 * map. See docs/M9-connectivity-layers.md.
 */

import { haversineM } from '../coverage/model.js';

// Resolve a CSS design token to its value, falling back to a literal. Same
// pattern as the rest of the codebase, but guarded with try/catch because the
// palette below resolves at module load — in the (node) unit-test environment
// there is no document/getComputedStyle, so we fall back to the hex literal.
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

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
  GSM:  { freqMHz: 900,  color: cssVar('--dim', '#94a3b8'),        label: '2G · GSM' },  // grey/slate
  UMTS: { freqMHz: 900,  color: cssVar('--feat-event', '#fbbf24'), label: '3G · UMTS' }, // amber
  LTE:  { freqMHz: 800,  color: cssVar('--feat-track', '#46a6ff'),      label: '4G · LTE' },  // azure
  NR:   { freqMHz: 3500, color: cssVar('--s1', '#34e6c2'),         label: '5G · NR' },   // teal
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

// ── Best network (M22) ──────────────────────────────────────────────────────

// Technology weighting for the best-network heuristic: a tower's distance is
// divided by its weight, so more capable technologies win against slightly
// closer legacy towers (a GSM tower must be ~30 % closer than LTE to win).
export const TYPE_WEIGHT = Object.freeze({ NR: 1.1, LTE: 1.0, GSM: 0.7, UMTS: 0.6 });

/** Group label for towers whose OSM node carries no operator tag. */
export const UNKNOWN_OPERATOR = 'Unknown operator';

/**
 * Which operator likely has the strongest signal at `point` — a proximity
 * heuristic over the fetched towers (closest tower per operator, distance
 * discounted by technology weight), NOT a propagation result.
 *
 * @param {Array<{lat:number, lon:number, radio:string, operator?:string|null}>} towers
 * @param {{lat:number, lng:number}} point
 * @returns {{operator:string, radio:string, distanceM:number,
 *            ranking:Array<{operator:string, radio:string, distanceM:number, score:number}>}|null}
 */
export function bestNetwork(towers = [], point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const perOperator = new Map(); // operator -> best-scoring tower entry
  for (const t of towers) {
    if (!t || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    const operator = (t.operator || '').trim() || UNKNOWN_OPERATOR;
    const distanceM = haversineM(point.lat, point.lng, t.lat, t.lon);
    const score = distanceM / (TYPE_WEIGHT[t.radio] ?? TYPE_WEIGHT.LTE);
    const prev = perOperator.get(operator);
    if (!prev || score < prev.score) perOperator.set(operator, { operator, radio: t.radio, distanceM, score });
  }
  if (!perOperator.size) return null;
  const ranking = [...perOperator.values()].sort((a, b) => a.score - b.score);
  const { operator, radio, distanceM } = ranking[0];
  return { operator, radio, distanceM, ranking };
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
 * Parse an Overpass response into tower objects, deduplicating nodes that
 * match more than one selector. Pure (unit-tested); keeps the OSM operator
 * tag for the M22 best-network indicator.
 * @returns {Array<{lat:number, lon:number, radio:string, operator:string|null}>}
 */
export function parseOverpassTowers(data) {
  const seen = new Set();
  const towers = [];
  for (const el of (data?.elements || [])) {
    if (!Number.isFinite(el?.lat) || !Number.isFinite(el?.lon)) continue;
    const key = `${el.lat},${el.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    towers.push({
      lat: el.lat,
      lon: el.lon,
      radio: inferRadioTypeFromTags(el.tags),
      operator: (el.tags?.operator || '').trim() || null,
    });
  }
  return towers;
}

/**
 * Fetch cell-tower nodes from OSM via Overpass API for the given bounding box.
 * Returns an array of { lat, lon, radio, operator } objects compatible with
 * selectTowers() and bestNetwork().
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
  return parseOverpassTowers(await res.json());
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

  // ── Tower marker layer (MapLibre GeoJSON source + circle layer) ───────────
  // Circles are colour-coded by network type using the CELL_TYPE_DEFAULTS colours.
  // Added lazily on first use; sits above coverage rasters, below AOI drawing.
  const TOWER_SRC = 'cell-towers';
  const TOWER_LAYER = 'cell-towers-layer';

  // The latest FeatureCollection, kept so a deferred layer add (style still
  // loading at call time) can flush it once the style is ready. M22 fix: the
  // old code bailed on `!map.isStyleLoaded()` with no retry — isStyleLoaded()
  // is false whenever any tile is in flight (constant after the M19/M20
  // resize-heavy UI), so tower markers silently never appeared.
  let pendingTowerData = null;
  let retryArmed = false;

  function ensureTowerLayer() {
    if (map.getSource(TOWER_SRC)) return true; // already set up
    try {
      // addSource/addLayer only throw before the style's first `load` event;
      // tiles merely being in flight is fine.
      map.addSource(TOWER_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const beforeId = map.getLayer('aoi-fill') ? 'aoi-fill' : undefined;
      map.addLayer({
        id: TOWER_LAYER,
        type: 'circle',
        source: TOWER_SRC,
        paint: {
          'circle-radius': 4,
          'circle-color': [
            'match', ['get', 'radio'],
            'GSM',  CELL_TYPE_DEFAULTS.GSM.color,
            'UMTS', CELL_TYPE_DEFAULTS.UMTS.color,
            'LTE',  CELL_TYPE_DEFAULTS.LTE.color,
            'NR',   CELL_TYPE_DEFAULTS.NR.color,
            CELL_TYPE_DEFAULTS.LTE.color,
          ],
          'circle-stroke-width': 1.5,
          // White contrast ring against the dark map canvas — no design token maps
          // to pure white; kept as a literal intentionally.
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
          'circle-stroke-opacity': 0.7,
        },
      }, beforeId);
      return true;
    } catch {
      // Style genuinely not loaded yet — retry once it is, then flush the
      // pending tower data recorded by updateTowerLayer().
      if (!retryArmed) {
        retryArmed = true;
        map.once('load', () => {
          retryArmed = false;
          if (ensureTowerLayer() && pendingTowerData) setTowerData(pendingTowerData);
        });
      }
      return false;
    }
  }

  function setTowerData(fc) {
    map.getSource(TOWER_SRC).setData(fc);
    if (map.getLayer(TOWER_LAYER)) {
      map.setLayoutProperty(TOWER_LAYER, 'visibility', fc.features.length ? 'visible' : 'none');
    }
  }

  /** Update GeoJSON source with towers belonging to the given set of types. */
  function updateTowerLayer(towers, wantTypes) {
    const features = towers
      .filter((t) => !wantTypes || wantTypes.has(t.radio))
      .map((t) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        properties: { radio: t.radio },
      }));
    pendingTowerData = { type: 'FeatureCollection', features };
    if (ensureTowerLayer()) setTowerData(pendingTowerData);
  }

  // ─────────────────────────────────────────────────────────────────────────

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
    // Pass AOI for clipping: when an AOI is set, cells outside it are rendered
    // transparent; coverage only appears within the drawn area.
    const aoi = o.aoi ?? null;
    cov.compute(bbox, center, params, {
      txs: towersToTxs(towers, txHeightM),
      marker: false,
      aoi,
      clipToAoi: !!aoi,
    });
    return towers.length;
  }

  /**
   * Fetch towers from Overpass (if needed) then paint coverage for each
   * checked network type on its own coloured layer using the signal quality
   * scale. Async. When an AOI shape is supplied via `o.aoi`, coverage is
   * clipped to that area; otherwise the full viewport is used.
   * @param {Array<'GSM'|'UMTS'|'LTE'|'NR'>} types
   * @param {{useTerrain?:boolean, useClutter?:boolean, maxN?:number, aoi?:object|null}} o
   */
  async function showCoverage(types = [], o = {}) {
    // Use AOI bounds for the fetch+compute bbox when an AOI is drawn; otherwise
    // fall back to the viewport so coverage fills the visible area.
    const fetchBbox = o.aoi?.bounds ?? viewportBbox();

    // Re-fetch whenever the cached bbox does not fully contain the new area —
    // bboxContains is the correct gate (a nearby but uncovered area still needs
    // its towers).
    const needFetch = !cachedBbox || !bboxContains(cachedBbox, fetchBbox);
    if (needFetch) {
      onStatus?.('loading', { count: 0, totals: {} });
      try {
        cachedTowers = await fetchTowersFromOSM(fetchBbox);
        cachedBbox = fetchBbox;
        meta.generated = new Date().toISOString();
      } catch (err) {
        onStatus?.('error', { message: err.message });
        return { count: 0, totals: {} };
      }
    }

    const want = new Set(types);
    const center = o.aoi?.center ?? (() => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; })();
    const totals = {};
    let grand = 0;
    for (const type of CELL_ORDER) {
      if (!want.has(type)) { coverages[type]?.clear(); totals[type] = 0; continue; }
      const n = computeType(type, fetchBbox, center, o);
      totals[type] = n;
      grand += n;
    }
    lastCount = grand;

    // Place tower markers for the active types.
    updateTowerLayer(cachedTowers, want);

    onStatus?.(grand ? 'computing' : 'empty', { count: grand, totals });
    return { count: grand, totals };
  }

  function setVisible(on) {
    for (const type of CELL_ORDER) coverages[type]?.setVisible(on);
    if (map.getLayer(TOWER_LAYER)) {
      map.setLayoutProperty(TOWER_LAYER, 'visibility', on ? 'visible' : 'none');
    }
  }

  function clear() {
    for (const type of CELL_ORDER) coverages[type]?.clear();
    cachedTowers = [];
    cachedBbox = null;
    lastCount = 0;
    // Clear tower markers (and any pending data awaiting a deferred add).
    pendingTowerData = null;
    if (map.getSource(TOWER_SRC)) {
      map.getSource(TOWER_SRC).setData({ type: 'FeatureCollection', features: [] });
    }
    if (map.getLayer(TOWER_LAYER)) {
      map.setLayoutProperty(TOWER_LAYER, 'visibility', 'none');
    }
  }

  return {
    showCoverage,
    setVisible,
    clear,
    getCount: () => lastCount,
    getMeta: () => ({ ...meta }),
    hasData: () => cachedTowers.length > 0,
    /** M22: best-network heuristic at a probe point, from the cached towers. */
    bestNetworkAt: (point) => bestNetwork(cachedTowers, point),
  };
}

/** True when bbox `a` fully contains bbox `b`. */
function bboxContains(a, b) {
  return a.west <= b.west && a.east >= b.east && a.south <= b.south && a.north >= b.north;
}
