/**
 * KML / KMZ export — sites, waypoints and the AOI as placemarks, plus a
 * coverage GroundOverlay.
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

// Closed rectangle ring for the AOI / coverage extent (lng,lat tuples).
function boundsRing(b) {
  const { west, south, east, north } = b;
  return [
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ].map(([lng, lat]) => `${num(lng)},${num(lat)}`).join(' ');
}

/**
 * Build a KML document from the mission features.
 * @param {{ sites?:Array, waypoints?:Array, bounds?:object, missionName?:string }} data
 *   sites:     [{ lat, lng, label|name, elevM? }]
 *   waypoints: [{ lat, lng, name, altM? }]
 *   bounds:    { west, south, east, north }  → drawn as the coverage extent
 * @returns {string} KML text
 */
export function buildKml({ sites = [], waypoints = [], bounds = null, missionName = 'GroundLink mission' } = {}) {
  const parts = [];

  for (const s of sites) {
    const label = s.label || s.name || 'Site';
    const elev = s.elevM != null ? `Elevation ${Math.round(s.elevM)} m` : 'Comms site';
    parts.push(placemark(label, s.lng, s.lat, { description: elev }));
  }
  for (const w of waypoints) {
    parts.push(placemark(w.name || 'Waypoint', w.lng, w.lat, { alt: w.altM, description: 'Waypoint' }));
  }
  if (bounds) {
    parts.push(`    <Placemark>
      <name>Coverage area</name>
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
 * @param {{ kml:string, overlayPng:string, bounds:object, sites?:Array, waypoints?:Array, missionName?:string }} data
 *   kml        pre-built document KML (falls back to buildKml from sites/waypoints)
 *   overlayPng coverage canvas as a data:image/png;base64 URL
 * @returns {Promise<Uint8Array>} KMZ bytes
 */
export async function buildKmz(data) {
  const { overlayPng, bounds, sites, waypoints, missionName } = data;
  const docKml = data.kml || buildKml({ sites, waypoints, bounds, missionName });

  const entries = [{ name: 'doc.kml', data: docKml }];
  if (overlayPng && bounds) {
    entries.push({ name: 'overlay.png', data: dataUrlToBytes(overlayPng) });
    entries.push({ name: 'overlay.kml', data: buildGroundOverlayKml('overlay.png', bounds) });
  }
  return makeZip(entries);
}
