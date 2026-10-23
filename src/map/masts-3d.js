/**
 * 3D masts on the map (M51 phase 1) — every fixed site as a small set of
 * extruded prisms at its real height (`txHeightM`, or the panel's mast
 * height), a rotated panel at the top for a directional antenna, and the
 * drone relay as a hovering body with a thin tether to the ground. Drawn
 * with MapLibre's own `fill-extrusion` layer, like the buildings: no new
 * dependency. Shown only while 3D terrain is on; in the flat view the pins
 * do the job. Spec: docs/M51-3d-masts.md.
 *
 * Pure geometry first (unit-tested, DOM-free); updateMasts3d() wires the map.
 */

import { isOmni } from '../coverage/antenna.js';

const SRC = 'gl-masts-3d';
const LAYER = 'gl-masts-3d';
const SIDES = 12;

/** Metres → degrees at this latitude (lng scaled by cos lat). */
function metresToDeg(lat) {
  const dLat = 1 / 111320;
  const dLng = 1 / (111320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLng };
}

/** A regular polygon ring (lng/lat) of `radiusM` around a point. */
export function discRing(lng, lat, radiusM, sides = SIDES) {
  const { dLat, dLng } = metresToDeg(lat);
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([lng + Math.cos(a) * radiusM * dLng, lat + Math.sin(a) * radiusM * dLat]);
  }
  ring.push(ring[0]);
  return ring;
}

/** A `lenM` × `widM` rectangle centred on the point, its long side across the azimuth. */
export function panelRing(lng, lat, azimuthDeg, lenM, widM) {
  const { dLat, dLng } = metresToDeg(lat);
  const az = (azimuthDeg * Math.PI) / 180; // 0 = north, clockwise
  // Along-azimuth unit (east, north) and its perpendicular.
  const ax = Math.sin(az), ay = Math.cos(az);
  const px = ay, py = -ax;
  const pts = [
    [-lenM / 2, -widM / 2], [lenM / 2, -widM / 2], [lenM / 2, widM / 2], [-lenM / 2, widM / 2],
  ].map(([u, v]) => {
    const e = u * px + v * ax; // u along the perpendicular (panel face), v along the azimuth
    const n = u * py + v * ay;
    return [lng + e * dLng, lat + n * dLat];
  });
  pts.push(pts[0]);
  return pts;
}

const feat = (ring, props) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props });

/**
 * GeoJSON for the masts. Pure.
 * @param {Array<{id,lat,lng,name?,txHeightM?,azimuthDeg?}>} sites
 * @param {{ panelHeightM:number, antenna?:object|null, drone?:{lng,lat,altM}|null }} o
 */
export function mastFeatures(sites, { panelHeightM = 10, antenna = null, drone = null } = {}) {
  const features = [];
  const directional = antenna && !isOmni(antenna);
  for (const s of sites) {
    const h = Math.max(1, Number(s.txHeightM ?? panelHeightM) || panelHeightM);
    const id = s.id ?? `${s.lat},${s.lng}`;
    features.push(feat(discRing(s.lng, s.lat, 4), { id, part: 'plinth', base: 0, top: 1, site: s.name ?? '' }));
    features.push(feat(discRing(s.lng, s.lat, 1.1), { id, part: 'mast', base: 0, top: h, site: s.name ?? '' }));
    features.push(feat(discRing(s.lng, s.lat, 2.2), { id, part: 'head', base: Math.max(0, h - 1.5), top: h, site: s.name ?? '' }));
    if (directional) {
      const az = s.azimuthDeg ?? antenna.azimuthDeg ?? 0;
      features.push(feat(panelRing(s.lng, s.lat, az, 2.4, 0.5), { id, part: 'panel', base: Math.max(0, h - 2), top: Math.max(0.5, h - 0.5), site: s.name ?? '' }));
    }
  }
  if (drone && Number.isFinite(drone.lat) && Number.isFinite(drone.lng)) {
    const alt = Math.max(2, Number(drone.altM) || 100);
    features.push(feat(discRing(drone.lng, drone.lat, 0.15), { id: 'drone', part: 'tether', base: 0, top: alt - 1 }));
    features.push(feat(discRing(drone.lng, drone.lat, 1.5), { id: 'drone', part: 'drone', base: alt - 1, top: alt }));
  }
  return { type: 'FeatureCollection', features };
}

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const pending = new WeakMap();

/**
 * Add or refresh the masts layer. `visible` follows the 3D toggle.
 * @param {import('maplibre-gl').Map} map
 */
export function updateMasts3d(map, sites, opts = {}, { visible = true } = {}) {
  if (!map) return;
  const data = mastFeatures(sites, opts);
  const site = cssColor('--feat-site', '#34e6c2');
  const asset = cssColor('--feat-track', '#46a6ff');
  // The mast body is a dark neutral so it reads on the teal raster too; the
  // head and plinth carry the site colour, antenna panel and drone the asset colour.
  const body = cssColor('--mapbg', '#0b1018');
  const paint = {
    'fill-extrusion-color': ['match', ['get', 'part'], 'mast', body, 'panel', asset, 'drone', asset, 'tether', asset, site],
    'fill-extrusion-height': ['get', 'top'],
    'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-opacity': 0.95,
    'fill-extrusion-vertical-gradient': true,
  };
  const src = map.getSource(SRC);
  if (src) {
    src.setData(data);
    for (const [k, v] of Object.entries(paint)) map.setPaintProperty(LAYER, k, v);
    map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
    return;
  }
  try {
    map.addSource(SRC, { type: 'geojson', data });
    map.addLayer({ id: LAYER, type: 'fill-extrusion', source: SRC, minzoom: 11, layout: { visibility: visible ? 'visible' : 'none' }, paint });
  } catch {
    // Style not ready yet: keep the newest call, replay on the next idle.
    const queued = pending.has(map);
    pending.set(map, [sites, opts, { visible }]);
    if (!queued) {
      map.once('idle', () => {
        const args = pending.get(map);
        pending.delete(map);
        if (args) updateMasts3d(map, ...args);
      });
    }
  }
}

/** Show or hide the layer without rebuilding it. */
export function setMasts3dVisible(map, visible) {
  if (map?.getLayer(LAYER)) map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
}
