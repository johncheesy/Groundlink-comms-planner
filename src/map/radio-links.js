/**
 * Radio links on the map (M50) — one line per link between two fixed sites
 * (point-to-point links, backhaul to a repeater). Unchecked links are dashed
 * in the neutral map ink; once a link's path profile has run the line takes
 * the coverage spectrum: teal with fade margin, amber when tight or the
 * Fresnel zone is blocked, rose when the link does not close.
 */

import { haversineM } from '../coverage/model.js';
import { linkVerdict, LINK_FADE_MARGIN_DB } from '../analysis/path-profile.js';

export { LINK_FADE_MARGIN_DB };

const SRC = 'gl-radio-links';
const LAYER = 'gl-radio-links';
const LAYER_CASE = 'gl-radio-links-case';
const LAYER_DASH = 'gl-radio-links-dash';

/**
 * Status of a checked link from its path-profile result.
 * @param {{ budget:{marginDb:number}, obstructed:boolean } | null} check
 * @returns {'unknown'|'ok'|'warn'|'bad'}
 */
export function linkStatus(check) {
  return linkVerdict(check).status;
}

/**
 * GeoJSON lines for the links whose two sites exist. Pure.
 * @param {Array<{id, lat, lng, name}>} sites
 * @param {Array<{id, a, b, label}>} links
 * @param {Map<string, object>} [checks]  link id → last path-profile result
 */
export function linkFeatures(sites, links, checks = new Map()) {
  const byId = new Map(sites.map((s) => [s.id, s]));
  const features = [];
  for (const l of links) {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
      properties: {
        id: l.id,
        label: l.label || `${a.name || 'Site'} – ${b.name || 'Site'}`,
        km: Math.round(haversineM(a.lat, a.lng, b.lat, b.lng) / 100) / 10,
        status: linkStatus(checks.get(l.id)),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const pending = new WeakMap();

/** Add/refresh the link layer. Retries on idle while the style is busy. */
export function updateRadioLinks(map, data) {
  if (!map) return;
  const src = map.getSource(SRC);
  if (src) {
    src.setData(data);
    return;
  }
  try {
    map.addSource(SRC, { type: 'geojson', data });
    // A dark casing under the line keeps it readable on bright imagery.
    map.addLayer({
      id: LAYER_CASE,
      type: 'line',
      source: SRC,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': cssColor('--mapbg', '#0b1018'), 'line-width': 6, 'line-opacity': 0.55 },
    });
    map.addLayer({
      id: LAYER,
      type: 'line',
      source: SRC,
      filter: ['!=', ['get', 'status'], 'unknown'],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['match', ['get', 'status'],
          'ok', cssColor('--s1', '#34e6c2'),
          'warn', cssColor('--s3', '#ffd479'),
          cssColor('--s5', '#ff6b8a')],
        'line-width': 3,
      },
    });
    // Not yet checked: dashed, neutral.
    map.addLayer({
      id: LAYER_DASH,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'status'], 'unknown'],
      paint: { 'line-color': cssColor('--mapink', '#cfe7e2'), 'line-width': 3, 'line-dasharray': [2, 1.5] },
    });
  } catch {
    const queued = pending.has(map);
    pending.set(map, data);
    if (!queued) {
      map.once('idle', () => {
        const d = pending.get(map);
        pending.delete(map);
        if (d) updateRadioLinks(map, d);
      });
    }
  }
}

/** Layers that take clicks (both line styles). */
export const RADIO_LINK_LAYERS = [LAYER, LAYER_DASH];
