import maplibregl from 'maplibre-gl';

/**
 * Import KML / KMZ / GPX and render it on the map.
 *
 * Parsing is done in the browser with DOMParser — no build-time dependency.
 * KMZ is a zip with a KML inside; JSZip is loaded lazily from a CDN only when a
 * .kmz is actually opened, so it never weighs down the main bundle. Imported
 * features land in one accumulating GeoJSON source with three typed layers
 * (polygons, lines, points) and a click popup carrying the name/description.
 *
 * Imported data is client-side only and never uploaded (OPSEC).
 */

const SRC = 'imported';
const FILL = 'imported-fill';
const LINE = 'imported-line';
const OUTLINE = 'imported-outline';
const POINTS = 'imported-points';
const LABELS = 'imported-labels';

const JSZIP_CDN = 'https://esm.sh/jszip@3.10.1';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ---- Parsers ------------------------------------------------------------

function parseDoc(text, type) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`Malformed ${type}`);
  return doc;
}

// KML coords: "lng,lat[,alt] lng,lat[,alt] …" (whitespace-separated tuples).
function parseKmlCoords(text) {
  return (text || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => [lng, lat]);
}

function textOf(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : '';
}

function kmlToGeoJSON(doc) {
  const features = [];
  const placemarks = doc.getElementsByTagName('Placemark');
  for (const pm of placemarks) {
    const props = { name: textOf(pm, 'name'), description: textOf(pm, 'description') };

    for (const pt of pm.getElementsByTagName('Point')) {
      const c = parseKmlCoords(textOf(pt, 'coordinates'));
      if (c[0]) features.push(feat('Point', c[0], props));
    }
    for (const ls of pm.getElementsByTagName('LineString')) {
      const c = parseKmlCoords(textOf(ls, 'coordinates'));
      if (c.length >= 2) features.push(feat('LineString', c, props));
    }
    for (const pg of pm.getElementsByTagName('Polygon')) {
      const outer = pg.getElementsByTagName('outerBoundaryIs')[0];
      const ring = outer ? parseKmlCoords(textOf(outer, 'coordinates')) : [];
      if (ring.length >= 3) features.push(feat('Polygon', [ring], props));
    }
  }
  return { type: 'FeatureCollection', features };
}

function gpxToGeoJSON(doc) {
  const features = [];
  const attrNum = (el, a) => Number(el.getAttribute(a));

  for (const wpt of doc.getElementsByTagName('wpt')) {
    const lng = attrNum(wpt, 'lon');
    const lat = attrNum(wpt, 'lat');
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      features.push(feat('Point', [lng, lat], { name: textOf(wpt, 'name'), description: textOf(wpt, 'desc') }));
    }
  }

  const lineFrom = (parent, ptTag, name) => {
    const coords = [];
    for (const p of parent.getElementsByTagName(ptTag)) {
      const lng = attrNum(p, 'lon');
      const lat = attrNum(p, 'lat');
      if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lng, lat]);
    }
    if (coords.length >= 2) features.push(feat('LineString', coords, { name }));
  };

  for (const trk of doc.getElementsByTagName('trk')) {
    const name = textOf(trk, 'name');
    for (const seg of trk.getElementsByTagName('trkseg')) lineFrom(seg, 'trkpt', name);
  }
  for (const rte of doc.getElementsByTagName('rte')) lineFrom(rte, 'rtept', textOf(rte, 'name'));

  return { type: 'FeatureCollection', features };
}

function feat(type, coordinates, properties) {
  return { type: 'Feature', geometry: { type, coordinates }, properties };
}

async function fileToGeoJSON(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'kml') return kmlToGeoJSON(parseDoc(await file.text(), 'KML'));
  if (ext === 'gpx') return gpxToGeoJSON(parseDoc(await file.text(), 'GPX'));
  if (ext === 'kmz') {
    const { default: JSZip } = await import(/* @vite-ignore */ JSZIP_CDN);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!entry) throw new Error('No .kml inside the .kmz');
    return kmlToGeoJSON(parseDoc(await zip.files[entry].async('string'), 'KML'));
  }
  throw new Error(`Unsupported file type: .${ext}`);
}

// ---- Bounds helper ------------------------------------------------------

function extendBounds(bounds, geom) {
  const walk = (c) => {
    if (typeof c[0] === 'number') bounds.extend(c);
    else c.forEach(walk);
  };
  walk(geom.coordinates);
}

// ---- Controller ---------------------------------------------------------

export function createImportController(map, { onStatus } = {}) {
  let data = { type: 'FeatureCollection', features: [] };
  let popup = null;

  function ensureLayers() {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data });

    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': cssVar('--feat-track', '#46a6ff'), 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: OUTLINE,
      type: 'line',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': cssVar('--feat-track', '#46a6ff'), 'line-width': 1.6 },
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SRC,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': cssVar('--feat-track', '#46a6ff'), 'line-width': 2.4 },
    });
    map.addLayer({
      id: POINTS,
      type: 'circle',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': cssVar('--feat-site', '#34e6c2'),
        'circle-stroke-color': '#0b1018',
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: LABELS,
      type: 'symbol',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': cssVar('--mapink', '#dfe6f2'),
        'text-halo-color': '#0b1018',
        'text-halo-width': 1.4,
      },
    });

    const showPopup = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties || {};
      const name = p.name || 'Imported feature';
      const desc = p.description ? `<div class="import-popup__desc">${p.description}</div>` : '';
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ closeButton: true, offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(`<div class="import-popup"><strong>${name}</strong>${desc}</div>`)
        .addTo(map);
    };
    for (const id of [POINTS, LINE, FILL]) {
      map.on('click', id, showPopup);
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
  }

  async function importFile(file) {
    onStatus?.(`Importing ${file.name}…`, 'busy');
    let fc;
    try {
      fc = await fileToGeoJSON(file);
    } catch (err) {
      console.warn('[import] parse failed', err);
      onStatus?.(`Could not import ${file.name}: ${err.message}`, 'error');
      return { ok: false };
    }
    if (!fc.features.length) {
      onStatus?.(`${file.name} held no points, lines or polygons.`, 'error');
      return { ok: false };
    }

    ensureLayers();
    data.features.push(...fc.features);
    map.getSource(SRC).setData(data);

    const bounds = new maplibregl.LngLatBounds();
    fc.features.forEach((f) => extendBounds(bounds, f.geometry));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 });

    onStatus?.(`Imported ${fc.features.length} feature${fc.features.length > 1 ? 's' : ''} from ${file.name}`, 'done');
    return { ok: true, count: fc.features.length };
  }

  function clear() {
    data = { type: 'FeatureCollection', features: [] };
    if (map.getSource(SRC)) map.getSource(SRC).setData(data);
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  return { importFile, clear, hasData: () => data.features.length > 0 };
}
