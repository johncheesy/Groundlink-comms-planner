/**
 * M16 export panel wiring — GeoTIFF, KMZ, GeoJSON and CivTAK data package.
 *
 * The buttons live in their own "Data export" section. They build their
 * payloads entirely client-side (see geotiff/kml/geojson/tak + zip) and
 * trigger a download. The panel is shown as soon as there is anything to
 * export — a coverage raster or mission data; the raster exports still
 * require a computed coverage run.
 */

// The format writers (geotiff/kml/geojson/tak/zip) load lazily on the first
// export click — together they're ~15 kB minified the startup path never
// needs. Handlers below are async and await this.
const writers = () =>
  Promise.all([
    import('./geotiff.js'),
    import('./kml.js'),
    import('./geojson.js'),
    import('./tak.js'),
    import('./zip.js'),
  ]).then(([geotiff, kml, geojson, tak, zip]) => ({ ...geotiff, ...kml, ...geojson, ...tak, ...zip }));

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
 *   els       { wrap, geotiffBtn, kmzBtn, geojsonBtn, takBtn, help }  DOM elements
 *   getExport () => { canvas, bounds, sites, waypoints, points, route, aoi, missionName } | null
 *             canvas/bounds are null until a coverage raster has been computed.
 *   onStatus  (msg) => void
 */
export function createExportPanel({ els, getExport, onStatus }) {
  const { wrap, geotiffBtn, kmzBtn, geojsonBtn, takBtn, help } = els;

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

  geotiffBtn?.addEventListener('click', async () => {
    const data = requireCoverage();
    if (!data) return;
    try {
      const { encodeCoverageGeoTIFF, worldFile, makeZip, dataUrlToBytes } = await writers();
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
      const { buildKmz } = await writers();
      const { canvas, bounds, sites, waypoints, points, route, aoi, missionName } = data;
      const kmz = await buildKmz({
        overlayPng: canvas.toDataURL('image/png'),
        bounds,
        sites,
        waypoints,
        points,
        route,
        aoi,
        missionName,
      });
      downloadBytes(kmz, 'application/vnd.google-earth.kmz', `groundlink-${stamp()}.kmz`);
      setHelp('Exported KMZ (sites, waypoints, points, route, AOI + coverage overlay) — opens in Google Earth. Generated locally.');
      onStatus?.('KMZ exported');
    } catch (err) {
      console.warn('[export] kmz failed', err);
      setHelp(`KMZ export failed: ${err.message}`);
    }
  });

  geojsonBtn?.addEventListener('click', async () => {
    const data = getExport?.();
    const hasVector = data && (
      data.sites?.length || data.waypoints?.length || data.points?.length ||
      (data.route?.length >= 2) || data.aoi
    );
    if (!hasVector) {
      setHelp('Nothing to export yet — add sites, waypoints, points, a route or an AOI first.');
      return;
    }
    try {
      const { buildMissionGeoJSON } = await writers();
      const fc = buildMissionGeoJSON(data);
      const bytes = new TextEncoder().encode(JSON.stringify(fc, null, 2));
      downloadBytes(bytes, 'application/geo+json', `groundlink-${stamp()}.geojson`);
      setHelp('Exported GeoJSON (sites, waypoints, points, route, AOI) — opens in any GIS. Generated locally.');
      onStatus?.('GeoJSON exported');
    } catch (err) {
      console.warn('[export] geojson failed', err);
      setHelp(`GeoJSON export failed: ${err.message}`);
    }
  });

  takBtn?.addEventListener('click', async () => {
    const data = requireCoverage();
    if (!data) return;
    try {
      const { buildTakPackage } = await writers();
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

  /** Show/hide the export section — visible once there is anything to export
   * (a coverage raster or any mission data). */
  function refresh(hasExportable) {
    if (wrap) wrap.hidden = !hasExportable;
  }

  return { refresh };
}
