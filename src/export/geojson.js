/**
 * GeoJSON export — the mission as a plain RFC 7946 FeatureCollection.
 *
 * Serialises sites (incl. recommended masts), named waypoints, demand points,
 * the route (LineString) and the real AOI (polygon ring or 72-point geodesic
 * circle ring) with a `kind` property per feature, so any GIS / web map can
 * style and filter them. Built and downloaded in the browser; nothing is
 * uploaded (OPSEC).
 */

function feature(geometry, properties) {
  return { type: 'Feature', geometry, properties };
}

const point = (lng, lat) => ({ type: 'Point', coordinates: [Number(lng), Number(lat)] });

/**
 * @param {object} data
 *   sites:     [{ lat, lng, label|name, elevM? }]
 *   waypoints: [{ lat, lng, name, icon?, altM? }]
 *   points:    [{ lat, lng, name? }]          demand points
 *   route:     [{ lat, lng }, ...]            ordered vertices
 *   aoi:       { type, ring:[[lng,lat],...], radiusM? } | null
 * @returns {object} GeoJSON FeatureCollection
 */
export function buildMissionGeoJSON({
  sites = [],
  waypoints = [],
  points = [],
  route = [],
  aoi = null,
  missionName = 'GroundLink mission',
} = {}) {
  const features = [];

  for (const s of sites) {
    const props = { kind: 'site', name: s.label || s.name || 'Site' };
    if (s.elevM != null && Number.isFinite(s.elevM)) props.elevM = Math.round(s.elevM);
    features.push(feature(point(s.lng, s.lat), props));
  }
  for (const w of waypoints) {
    const props = { kind: 'waypoint', name: w.name || 'Waypoint' };
    if (w.icon) props.icon = w.icon;
    if (w.altM != null && Number.isFinite(w.altM)) props.altM = w.altM;
    features.push(feature(point(w.lng, w.lat), props));
  }
  for (const p of points) {
    features.push(feature(point(p.lng, p.lat), { kind: 'demand-point', name: p.name || p.label || 'Point' }));
  }
  if (Array.isArray(route) && route.length >= 2) {
    features.push(feature(
      { type: 'LineString', coordinates: route.map((v) => [Number(v.lng), Number(v.lat)]) },
      { kind: 'route', name: 'Route' },
    ));
  }
  if (aoi && Array.isArray(aoi.ring) && aoi.ring.length >= 3) {
    // Close the ring per RFC 7946 (first position === last position).
    const ring = aoi.ring.map(([lng, lat]) => [Number(lng), Number(lat)]);
    const [x0, y0] = ring[0];
    const [xn, yn] = ring[ring.length - 1];
    if (x0 !== xn || y0 !== yn) ring.push([x0, y0]);
    const props = { kind: 'aoi', name: 'Area of interest', aoiType: aoi.type || 'polygon' };
    if (aoi.radiusM != null && Number.isFinite(aoi.radiusM)) props.radiusM = Math.round(aoi.radiusM);
    features.push(feature({ type: 'Polygon', coordinates: [ring] }, props));
  }

  return { type: 'FeatureCollection', name: missionName, features };
}
