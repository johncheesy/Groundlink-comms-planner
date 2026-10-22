/**
 * One file router for every way a file comes in (toolbar "Open / import",
 * map-rail import, ⌘O, drag-drop anywhere): decide by name — and for plain
 * .json by content — which loader a file belongs to. Pure, so the routing
 * and the summary text are unit-tested; main.js owns the loaders.
 */

import { looksLikeMissionFile, isMissionData } from './mission.js';

/** Extensions + MIME types the shared file picker offers. GeoTIFFs stay in the Data flyout. */
export const IMPORT_ACCEPT = [
  '.json', '.geojson', '.kml', '.kmz', '.gpx', '.csv',
  'application/json', 'application/geo+json',
  'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz',
  'application/gpx+xml', 'text/csv',
].join(',');

/** Short list of what can be imported, for hints and the drop overlay. */
export const IMPORT_KINDS_TEXT = 'mission file, KML/KMZ, GPX, GeoJSON or calibration CSV';

const ext = (name) => String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/**
 * Route by file name. Returns one of:
 *   'mission'     — *.groundlink.json (M21 loader)
 *   'json'        — plain .json: mission or GeoJSON, needs routeJsonText()
 *   'overlay'     — KML / KMZ / GPX / GeoJSON (M16 overlay import)
 *   'calibration' — RSSI field-measurement CSV (M27)
 *   'geotiff'     — local COG; elevation vs clutter is the user's call (Data flyout)
 *   'unknown'
 */
export function routeByName(name) {
  if (looksLikeMissionFile(name)) return 'mission';
  switch (ext(name)) {
    case 'json': return 'json';
    case 'geojson':
    case 'kml':
    case 'kmz':
    case 'gpx': return 'overlay';
    case 'csv': return 'calibration';
    case 'tif':
    case 'tiff': return 'geotiff';
    default: return 'unknown';
  }
}

/** Content sniff for a plain .json: a renamed mission file, else GeoJSON for the overlay importer. */
export function routeJsonText(text) {
  try {
    return isMissionData(JSON.parse(text)) ? 'mission' : 'overlay';
  } catch {
    return 'overlay'; // not JSON at all — the importer reports the parse error
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 points, 1 line" from an importer byType count (zeros left out). */
export function describeFeatureCounts({ points = 0, lines = 0, polygons = 0 } = {}) {
  const bits = [];
  if (points) bits.push(plural(points, 'point'));
  if (lines) bits.push(plural(lines, 'line'));
  if (polygons) bits.push(plural(polygons, 'polygon'));
  return bits.join(', ');
}

/**
 * One toast line for a batch of routed files, saying what loaded and where it
 * went. results: [{ name, kind, ok, count?, byType?, warnings?, error?, message? }]
 * in file order; a failure's message (a full sentence) wins over error (a reason).
 * Returns '' when there is nothing to say.
 */
export function describeImports(results) {
  const lines = [];
  for (const r of results ?? []) {
    if (!r) continue;
    if (!r.ok) {
      if (r.kind === 'geotiff') lines.push(`${r.name}: load GeoTIFFs as elevation or clutter in the Data panel on the map rail.`);
      else if (r.kind === 'unknown') lines.push(`${r.name}: not a file GroundLink can open. Use a ${IMPORT_KINDS_TEXT}.`);
      else if (r.message) lines.push(r.message); // the loader's own full sentence
      else lines.push(`${r.name} not imported${r.error ? `: ${r.error}` : '.'}`);
      continue;
    }
    if (r.kind === 'mission') {
      lines.push(r.warnings?.length
        ? `Mission loaded from ${r.name}, but some items were skipped. ${r.warnings[0]}`
        : `Mission loaded from ${r.name} and placed on the map.`);
    } else if (r.kind === 'overlay') {
      const what = describeFeatureCounts(r.byType) || plural(r.count ?? 0, 'feature');
      const them = r.count === 1 ? 'it' : 'them';
      lines.push(`${what} from ${r.name} shown on the map. Use ${them} as sites, route or area in the Mission panel.`);
    } else if (r.kind === 'calibration') {
      lines.push(`${plural(r.count ?? 0, 'field measurement')} from ${r.name} compared with the model in Coverage › Field calibration.`);
    }
  }
  return lines.join(' ');
}
