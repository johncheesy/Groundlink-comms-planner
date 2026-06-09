/**
 * CivTAK / ATAK data package (Mission Package) export.
 *
 * A CivTAK data package is a zip with a `MANIFEST/manifest.xml` describing the
 * contents, plus the payload files. ATAK imports the bundled KML (sites +
 * waypoints become markers) and drapes the coverage GroundOverlay over the map.
 *
 * Built and downloaded in the browser; nothing is uploaded (OPSEC).
 */

import { makeZip, dataUrlToBytes, uuid } from './zip.js';
import { buildKml, buildGroundOverlayKml } from './kml.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function manifest(uid, name, contents) {
  const rows = contents.map((z) => `    <Content ignore="false" zipEntry="${esc(z)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="${esc(uid)}"/>
    <Parameter name="name" value="${esc(name)}"/>
    <Parameter name="onReceiveImport" value="true"/>
    <Parameter name="onReceiveDelete" value="false"/>
  </Configuration>
  <Contents>
${rows}
  </Contents>
</MissionPackageManifest>`;
}

/**
 * Build a CivTAK data package zip.
 * @param {{ sites?:Array, waypoints?:Array, overlayPng?:string, bounds?:object, missionName?:string }} opts
 * @returns {Promise<Uint8Array>} data package (zip) bytes
 */
export async function buildTakPackage({ sites = [], waypoints = [], overlayPng, bounds, missionName = 'GroundLink mission' } = {}) {
  const uid = uuid();
  const kmlName = `${uid}.kml`;

  const docKml = buildKml({ sites, waypoints, bounds, missionName });

  const contents = [kmlName];
  const entries = [{ name: kmlName, data: docKml }];

  if (overlayPng && bounds) {
    entries.push({ name: 'coverage.png', data: dataUrlToBytes(overlayPng) });
    entries.push({ name: 'coverage.kml', data: buildGroundOverlayKml('coverage.png', bounds) });
    contents.push('coverage.kml');
  }

  entries.push({ name: 'MANIFEST/manifest.xml', data: manifest(uid, missionName, contents) });

  return makeZip(entries);
}
