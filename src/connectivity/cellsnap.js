/**
 * OpenCelliD snapshot loading (M9 follow-up) — the pre-baked tower source.
 *
 * scripts/fetch-opencellid.mjs bakes public/cells/<region>.json (and maintains
 * public/cells/index.json) at data-prep time with a free OpenCelliD key that
 * never ships. At runtime this module reads those static files — no key, no
 * external API — and turns cells into the tower shape the cellular controller
 * uses. Areas no snapshot covers fall back to the live Overpass fetch
 * (cellular.js), so the app keeps working globally.
 *
 * Why a snapshot beats live OSM here: OpenCelliD rows carry the MCC/MNC pair,
 * which IS the operator (mapped to brand names below) — OSM tower nodes mostly
 * lack operator tags, so the M22 best-network indicator degrades to "Unknown
 * operator". Snapshot positions are measured cell locations rather than
 * crowdsourced mast guesses, and the radio generation is recorded, not
 * inferred from tags.
 *
 * Pure helpers are exported for tests; only loadSnapshotTowers() touches fetch.
 */

const INDEX_URL = 'cells/index.json'; // relative → works under the Pages subpath

/**
 * MCC-MNC → operator brand. Public numbering-plan data; current brand names,
 * with legacy codes folded into their present owner (e.g. Tele2/T-Mobile NL →
 * Odido, Telfort → KPN). Deliberately small: the snapshot regions we bake
 * (NL + neighbours) — everything else gets the honest numeric fallback.
 */
export const OPERATORS = Object.freeze({
  204: { 2: 'Odido', 4: 'Vodafone', 8: 'KPN', 10: 'KPN', 12: 'KPN', 16: 'Odido', 20: 'Odido' }, // NL
  206: { 1: 'Proximus', 10: 'Orange', 20: 'Base' }, // BE
  262: { 1: 'Telekom', 2: 'Vodafone', 3: 'O2', 4: 'Vodafone', 6: 'Telekom', 7: 'O2', 8: 'O2', 9: 'Vodafone', 11: 'O2' }, // DE
  208: { 1: 'Orange', 2: 'Orange', 10: 'SFR', 13: 'SFR', 15: 'Free', 16: 'Free', 20: 'Bouygues', 21: 'Bouygues', 88: 'Bouygues' }, // FR
});

/**
 * Operator brand for an (mcc, net) pair; numeric fallback for codes outside
 * the table so the UI never invents a brand; null when codes are absent.
 */
export function operatorForCell(mcc, net) {
  if (!Number.isFinite(mcc) || !Number.isFinite(net)) return null;
  return OPERATORS[mcc]?.[net] ?? `MCC ${mcc} · MNC ${net}`;
}

const RADIO_SET = new Set(['GSM', 'UMTS', 'LTE', 'NR']);
const round4 = (n) => Math.round(n * 1e4) / 1e4; // ~11 m — collapses sector cells

/**
 * Snapshot cells → controller towers ({lat, lon, radio, operator, range}).
 * OpenCelliD rows are per-CELL (several sectors per physical site); colocated
 * cells of the same radio + operator collapse to one tower so the coverage
 * compute and the marker layer see sites, not sectors. Pure.
 */
export function parseSnapshotTowers(snapshot) {
  const seen = new Set();
  const towers = [];
  for (const c of snapshot?.cells || []) {
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    if (!RADIO_SET.has(c.radio)) continue;
    const operator = operatorForCell(c.mcc, c.net);
    const key = `${round4(c.lat)},${round4(c.lon)},${c.radio},${operator ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    towers.push({ lat: c.lat, lon: c.lon, radio: c.radio, operator, range: c.range ?? null });
  }
  return towers;
}

/** True when bbox `a` fully contains bbox `b`. */
const contains = (a, b) =>
  a && b && a.west <= b.west && a.east >= b.east && a.south <= b.south && a.north >= b.north;

/**
 * Pick the index entry whose bbox contains the requested area — the smallest
 * one when several do (a country file beats a continent file). Pure; null
 * when nothing covers the bbox (callers fall back to Overpass).
 */
export function snapshotForBbox(index, bbox) {
  const candidates = (index?.regions || []).filter((r) => contains(r.bbox, bbox));
  if (!candidates.length) return null;
  const area = (b) => Math.max(0, b.east - b.west) * Math.max(0, b.north - b.south);
  return candidates.reduce((best, r) => (area(r.bbox) < area(best.bbox) ? r : best));
}

// One index fetch per session; a missing index (404 / offline / no snapshots
// baked) caches as null so every coverage run doesn't re-probe.
let indexPromise = null;

/**
 * Towers + meta from the snapshot covering `bbox`, or null (→ Overpass).
 * @param {{west,south,east,north}} bbox
 * @param {typeof fetch} [fetchImpl]  injected in tests
 */
export async function loadSnapshotTowers(bbox, fetchImpl = (u) => fetch(u)) {
  try {
    if (!indexPromise) {
      indexPromise = fetchImpl(INDEX_URL)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    const index = await indexPromise;
    const entry = snapshotForBbox(index, bbox);
    if (!entry) return null;
    const res = await fetchImpl(`cells/${entry.file}`);
    if (!res.ok) return null;
    const snapshot = await res.json();
    const towers = parseSnapshotTowers(snapshot);
    if (!towers.length) return null;
    return {
      towers,
      meta: {
        source: 'opencellid',
        region: snapshot.region ?? entry.region,
        attribution: snapshot.attribution ?? 'Cell data © OpenCelliD contributors (CC BY-SA 4.0)',
        generated: snapshot.generated ?? null,
      },
    };
  } catch {
    return null; // any failure → live Overpass path
  }
}

/** Test/HMR hook: forget the cached index. */
export function resetSnapshotCache() {
  indexPromise = null;
}
