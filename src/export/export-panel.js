/**
 * M16 export panel wiring — GeoTIFF, KMZ and CivTAK data package.
 *
 * The three buttons live under the comms-plan export block. They build their
 * payloads entirely client-side (see geotiff/kml/tak + zip) and trigger a
 * download. They are shown only while a coverage raster is on the map, since
 * each export carries that raster.
 */

import { encodeCoverageGeoTIFF, worldFile } from './geotiff.js';
import { buildKmz } from './kml.js';
import { buildTakPackage } from './tak.js';
import { makeZip, dataUrlToBytes } from './zip.js';

function downloadBytes(bytes, mime, filename) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Local YYYY-MM-DD for filenames.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * @param {object} deps
 *   els       { wrap, geotiffBtn, kmzBtn, takBtn, help }  DOM elements
 *   getExport () => { canvas, bounds, sites, waypoints, missionName } | null
 *   onStatus  (msg) => void
 */
export function createExportPanel({ els, getExport, onStatus }) {
  const { wrap, geotiffBtn, kmzBtn, takBtn, help } = els;

  function setHelp(msg) {
    if (help) help.textContent = msg;
  }

  function requireCoverage() {
    const data = getExport?.();
    if (!data || !data.canvas || !data.bounds) {
      setHelp('Compute a coverage raster first — the exports carry that overlay.');
      return null;
    }
    return data;
  }

  geotiffBtn?.addEventListener('click', () => {
    const data = requireCoverage();
    if (!data) return;
    try {
      const { canvas, bounds } = data;
      const tiff = encodeCoverageGeoTIFF(canvas, bounds);
      const png = dataUrlToBytes(canvas.toDataURL('image/png'));
      // Bundle the GeoTIFF plus a PNG + world file so any GIS can read it.
      const zip = makeZip([
        { name: 'coverage.tif', data: tiff },
        { name: 'coverage.png', data: png },
        { name: 'coverage.pgw', data: worldFile(bounds, canvas.width, canvas.height) },
        { name: 'coverage.tfw', data: worldFile(bounds, canvas.width, canvas.height) },
      ]);
      downloadBytes(zip, 'application/zip', `groundlink-raster-${stamp()}.zip`);
      setHelp('Exported GeoTIFF + PNG/world file (.zip) — drag into QGIS or Google Earth. Generated locally.');
      onStatus?.('GeoTIFF exported');
    } catch (err) {
      console.warn('[export] geotiff failed', err);
      setHelp(`GeoTIFF export failed: ${err.message}`);
    }
  });

  kmzBtn?.addEventListener('click', async () => {
    const data = requireCoverage();
    if (!data) return;
    try {
      const { canvas, bounds, sites, waypoints, missionName } = data;
      const kmz = await buildKmz({
        overlayPng: canvas.toDataURL('image/png'),
        bounds,
        sites,
        waypoints,
        missionName,
      });
      downloadBytes(kmz, 'application/vnd.google-earth.kmz', `groundlink-${stamp()}.kmz`);
      setHelp('Exported KMZ (sites, waypoints + coverage overlay) — opens in Google Earth. Generated locally.');
      onStatus?.('KMZ exported');
    } catch (err) {
      console.warn('[export] kmz failed', err);
      setHelp(`KMZ export failed: ${err.message}`);
    }
  });

  takBtn?.addEventListener('click', async () => {
    const data = requireCoverage();
    if (!data) return;
    try {
      const { canvas, bounds, sites, waypoints, missionName } = data;
      const pkg = await buildTakPackage({
        sites,
        waypoints,
        overlayPng: canvas.toDataURL('image/png'),
        bounds,
        missionName,
      });
      downloadBytes(pkg, 'application/zip', `groundlink-tak-${stamp()}.zip`);
      setHelp('Exported CivTAK data package — import in ATAK (Mission Package). Generated locally.');
      onStatus?.('TAK package exported');
    } catch (err) {
      console.warn('[export] tak failed', err);
      setHelp(`TAK package export failed: ${err.message}`);
    }
  });

  /** Show/hide the export block based on whether a coverage raster exists. */
  function refresh(hasCoverage) {
    if (wrap) wrap.hidden = !hasCoverage;
  }

  return { refresh };
}
