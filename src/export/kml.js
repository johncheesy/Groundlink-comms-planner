/**
 * KML / KMZ export — sites, waypoints, demand points, the route and the real
 * AOI as placemarks, plus a coverage GroundOverlay.
 *
 * `buildKml` produces a plain KML document (Google Earth / ATAK read it
 * directly). `buildKmz` bundles that KML with the coverage PNG and a
 * GroundOverlay into a single .kmz (a stored zip — see export/zip.js), so the
 * coverage drapes over the terrain in Google Earth without a second file.
 *
 * Built and downloaded in the browser; nothing is uploaded (OPSEC).
 */

import { makeZip, dataUrlToBytes } from './zip.js';

// XML-escape text and coordinates before they go into the document.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function placemark(name, lng, lat, { description, alt } = {}) {
  const desc = description ? `\n      <description>${esc(description)}</description>` : '';
  const z = alt != null && Number.isFinite(alt) ? `,${num(alt)}` : '';
  return `    <Placemark>
      <name>${esc(name)}</name>${desc}
      <Point><coordinates>${num(lng)},${num(lat)}${z}</coordinates></Point>
    </Placemark>`;
}

// Closed rectangle ring for the coverage extent (lng,lat tuples).
function boundsRing(b) {
  const { west, south, east, north } = b;
  return [
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ].map(([lng, lat]) => `${num(lng)},${num(lat)}`).join(' ');
}

// Closed coordinate string from an AOI ring of [lng, lat] pairs.
function closedRing(ring) {
  const pts = ring.map(([lng, lat]) => `${num(lng)},${num(lat)}`);
  if (pts[0] !== pts[pts.length - 1]) pts.push(pts[0]);
  return pts.join(' ');
}

/**
 * Build a KML document from the mission features.
 * @param {{ sites?:Array, waypoints?:Array, points?:Array, route?:Array, aoi?:object, bounds?:object, missionName?:string }} data
 *   sites:     [{ lat, lng, label|name, elevM? }]
 *   waypoints: [{ lat, lng, name, altM? }]
 *   points:    [{ lat, lng, name? }]          demand points
 *   route:     [{ lat, lng }, ...]            ordered vertices → LineString
 *   aoi:       { type, ring:[[lng,lat],...], radiusM? }  → the real AOI ring/circle
 *   bounds:    { west, south, east, north }  → drawn as the coverage extent
 * @returns {string} KML text
 */
export function buildKml({ sites = [], waypoints = [], points = [], route = [], aoi = null, bounds = null, missionName = 'GroundLink mission' } = {}) {
  const parts = [];

  for (const s of sites) {
    const label = s.label || s.name || 'Site';
    const elev = s.elevM != null ? `Elevation ${Math.round(s.elevM)} m` : 'Comms site';
    parts.push(placemark(label, s.lng, s.lat, { description: elev }));
  }
  for (const w of waypoints) {
    parts.push(placemark(w.name || 'Waypoint', w.lng, w.lat, { alt: w.altM, description: 'Waypoint' }));
  }
  for (const p of points) {
    parts.push(placemark(p.name || p.label || 'Point', p.lng, p.lat, { description: 'Demand point' }));
  }
  if (Array.isArray(route) && route.length >= 2) {
    const coords = route.map((v) => `${num(v.lng)},${num(v.lat)}`).join(' ');
    parts.push(`    <Placemark>
      <name>Route</name>
      <Style><LineStyle><color>ffffa646</color><width>3</width></LineStyle></Style>
      <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
    </Placemark>`);
  }
  if (aoi && Array.isArray(aoi.ring) && aoi.ring.length >= 3) {
    const desc = aoi.type === 'radius' && Number.isFinite(aoi.radiusM)
      ? `Circular AOI — radius ${Math.round(aoi.radiusM)} m`
      : 'Area of interest';
    parts.push(`    <Placemark>
      <name>Area of interest</name>
      <description>${esc(desc)}</description>
      <Style><LineStyle><color>ffc2e634</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${closedRing(aoi.ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`);
  }
  if (bounds) {
    parts.push(`    <Placemark>
      <name>Coverage extent</name>
      <Style><LineStyle><color>ff7ad4ff</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${boundsRing(bounds)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(missionName)}</name>
${parts.join('\n')}
  </Document>
</kml>`;
}

/**
 * GroundOverlay KML referencing an image draped over `bounds`.
 * @param {string} href      image filename inside the bundle (e.g. overlay.png)
 * @param {object} bounds    { west, south, east, north }
 * @param {string} name
 * @returns {string} KML text
 */
export function buildGroundOverlayKml(href, bounds, name = 'RF Coverage') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <GroundOverlay>
      <name>${esc(name)}</name>
      <Icon><href>${esc(href)}</href></Icon>
      <LatLonBox>
        <north>${num(bounds.north)}</north>
        <south>${num(bounds.south)}</south>
        <east>${num(bounds.east)}</east>
        <west>${num(bounds.west)}</west>
      </LatLonBox>
    </GroundOverlay>
  </Document>
</kml>`;
}

/**
 * Build a KMZ bundle (stored zip) with doc.kml, the coverage overlay PNG and a
 * GroundOverlay KML referencing it.
 * @param {{ kml:string, overlayPng:string, bounds:object, sites?:Array, waypoints?:Array, points?:Array, route?:Array, aoi?:object, missionName?:string }} data
 *   kml        pre-built document KML (falls back to buildKml from the mission features)
 *   overlayPng coverage canvas as a data:image/png;base64 URL
 * @returns {Promise<Uint8Array>} KMZ bytes
 */
export async function buildKmz(data) {
  const { overlayPng, bounds, sites, waypoints, points, route, aoi, missionName } = data;
  const docKml = data.kml || buildKml({ sites, waypoints, points, route, aoi, bounds, missionName });

  const entries = [{ name: 'doc.kml', data: docKml }];
  if (overlayPng && bounds) {
    entries.push({ name: 'overlay.png', data: dataUrlToBytes(overlayPng) });
    entries.push({ name: 'overlay.kml', data: buildGroundOverlayKml('overlay.png', bounds) });
  }
  return makeZip(entries);
}
