/**
 * High-resolution open aerial imagery, country by country.
 *
 * There is no global open satellite layer sharper than about 10 m (Sentinel-2).
 * The sharp open imagery (8 to 50 cm) comes from national orthophoto programmes.
 * Each source below is keyless, serves CORS headers and was probed live; it is
 * drawn ABOVE the global base layer, only inside its own bounds and only when
 * zoomed in, so the world map shows through everywhere else.
 *
 * Blank tiles: several services answer outside their coverage with a pure white
 * JPEG (or an error) instead of a missing tile. A white tile would hide the base
 * map, so the `hires://` tile handler turns white, empty and failed tiles into a
 * transparent pixel. That also makes a provider outage invisible instead of a
 * hole in the map.
 *
 * Licences are the providers' own and are listed in docs/DATA-SOURCES.md; check
 * them before any commercial use.
 */

// Single-tile transparent PNG (1x1).
const TRANSPARENT_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function transparentPng() {
  const bin = atob(TRANSPARENT_PNG_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Tiles under this size are candidates for "blank"; real photo tiles are larger. */
export const BLANK_CHECK_MAX_BYTES = 6000;

/**
 * Sources, best-resolution country data first within each region. `bounds` is
 * [west, south, east, north]. `template` uses {z} {x} {y} or {bbox} (EPSG:3857
 * metres, for WMS). `maxzoom` is the highest level the service really serves;
 * beyond it MapLibre enlarges the last tile.
 */
export const HIRES_SOURCES = Object.freeze([
  {
    id: 'fr-ign', label: 'IGN Orthophotos (France)', resolution: '20 cm', minzoom: 10, maxzoom: 19,
    bounds: [-5.2, 41.3, 9.7, 51.2],
    template: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    attribution: '© <a href="https://geoservices.ign.fr/">IGN</a> (Licence Ouverte)',
  },
  {
    id: 'es-pnoa', label: 'PNOA (Spain)', resolution: '25–50 cm', minzoom: 10, maxzoom: 19,
    bounds: [-9.4, 35.9, 4.4, 43.9],
    template: 'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
    attribution: '© <a href="https://pnoa.ign.es/">PNOA</a> © IGN España (CC BY 4.0)',
  },
  {
    id: 'pl-gugik', label: 'Geoportal orthophoto (Poland)', resolution: '25 cm', minzoom: 10, maxzoom: 19,
    bounds: [14.1, 49.0, 24.2, 54.9],
    template: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?service=WMTS&request=GetTile&version=1.0.0&layer=ORTOFOTOMAPA&style=default&format=image/jpeg&tilematrixset=EPSG:3857&tilematrix=EPSG:3857:{z}&tilerow={y}&tilecol={x}',
    attribution: '© <a href="https://www.geoportal.gov.pl/">GUGiK</a>',
  },
  {
    id: 'de-by', label: 'Bayern DOP (Germany)', resolution: '40 cm', minzoom: 10, maxzoom: 20,
    bounds: [8.95, 47.25, 13.85, 50.58],
    template: 'https://geoservices.bayern.de/od/wms/dop/v1/dop40?service=WMS&request=GetMap&version=1.1.1&layers=by_dop40c&styles=&format=image/jpeg&width=256&height=256&srs=EPSG:3857&bbox={bbox}',
    attribution: '© <a href="https://www.ldbv.bayern.de/">Bayerische Vermessungsverwaltung</a> (CC BY 4.0)',
  },
  {
    id: 'de-nrw', label: 'NRW DOP (Germany)', resolution: '10–20 cm', minzoom: 10, maxzoom: 20,
    bounds: [5.85, 50.30, 9.50, 52.55],
    template: 'https://www.wms.nrw.de/geobasis/wms_nw_dop?service=WMS&request=GetMap&version=1.1.1&layers=nw_dop_rgb&styles=&format=image/jpeg&width=256&height=256&srs=EPSG:3857&bbox={bbox}',
    attribution: '© <a href="https://www.bezreg-koeln.nrw.de/geobasis-nrw">Geobasis NRW</a> (dl-de/zero-2-0)',
  },
  {
    id: 'at-basemap', label: 'basemap.at Orthofoto (Austria)', resolution: '30 cm', minzoom: 10, maxzoom: 20,
    bounds: [9.5, 46.35, 17.2, 49.05],
    template: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    attribution: '© <a href="https://basemap.at/">basemap.at</a> (CC BY 4.0)',
  },
  {
    id: 'ch-swissimage', label: 'SWISSIMAGE (Switzerland)', resolution: '10 cm', minzoom: 10, maxzoom: 20,
    bounds: [5.95, 45.8, 10.55, 47.85],
    template: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    attribution: '© <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
  },
  {
    id: 'nl-pdok', label: 'PDOK Luchtfoto HR (Netherlands)', resolution: '8 cm', minzoom: 10, maxzoom: 20,
    bounds: [3.3, 50.74, 7.25, 53.56],
    template: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    attribution: '© <a href="https://www.pdok.nl/">PDOK</a> / Beeldmateriaal Nederland (CC BY 4.0)',
  },
  {
    id: 'be-vlaanderen', label: 'Orthofoto Vlaanderen (Belgium)', resolution: '25 cm', minzoom: 10, maxzoom: 20,
    bounds: [2.5, 50.67, 5.93, 51.52],
    template: 'https://geo.api.vlaanderen.be/OMW/wms?service=WMS&request=GetMap&version=1.1.1&layers=OMWRGB25VL&styles=&format=image/jpeg&width=256&height=256&srs=EPSG:3857&bbox={bbox}',
    attribution: '© <a href="https://www.vlaanderen.be/digitaal-vlaanderen">Digitaal Vlaanderen</a>',
  },
  {
    id: 'lu-geoportail', label: 'Orthophoto (Luxembourg)', resolution: '20 cm', minzoom: 10, maxzoom: 20,
    bounds: [5.73, 49.44, 6.54, 50.19],
    template: 'https://wmts3.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
    attribution: '© <a href="https://geoportail.lu/">Administration du cadastre et de la topographie</a>',
  },
  {
    // Mixed: NAIP (about 1 m or better) across the lower 48, coarser elsewhere. Only
    // shown when zoomed in, where NAIP is what you get.
    id: 'us-usgs', label: 'USGS Imagery (United States)', resolution: '≈ 0.3–1 m', minzoom: 13, maxzoom: 16,
    bounds: [-125.0, 24.4, -66.9, 49.6],
    template: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery: <a href="https://www.usgs.gov/">USGS</a> The National Map',
  },
]);

const byId = new Map(HIRES_SOURCES.map((s) => [s.id, s]));
export const hiresSource = (id) => byId.get(id) ?? null;

// ---- pure helpers ----------------------------------------------------------

/** EPSG:3857 bounding box of an XYZ tile, "west,south,east,north" in metres. */
export function tileBbox3857(z, x, y) {
  const R = 20037508.342789244;
  const size = (2 * R) / 2 ** z;
  const west = -R + x * size;
  const north = R - y * size;
  return `${west},${north - size},${west + size},${north}`;
}

/** Real tile URL for a source and tile coordinate. */
export function tileUrl(source, z, x, y) {
  return source.template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{bbox}', tileBbox3857(z, x, y));
}

/** Parse `hires://<id>/<z>/<x>/<y>`. */
export function parseHiresUrl(url) {
  const m = /^hires:\/\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(String(url));
  return m ? { id: m[1], z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null;
}

/**
 * Is a sampled tile "nothing to see"? True when almost every pixel is
 * transparent or pure white. `rgba` is a flat RGBA array (e.g. ImageData.data).
 * The bar is high on purpose: a snowfield or a roof is never uniformly
 * 250+ in all channels across the whole tile.
 */
export function isBlankPixels(rgba, { share = 0.985, white = 250 } = {}) {
  const px = Math.floor(rgba.length / 4);
  if (!px) return true;
  let blank = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0 || (rgba[i] >= white && rgba[i + 1] >= white && rgba[i + 2] >= white)) blank += 1;
  }
  return blank / px >= share;
}

const inBounds = (b, lng, lat) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];

/**
 * Sources that cover a position at a zoom level, sharpest listed first.
 * Where bounds of neighbouring countries overlap (their rectangles do), every
 * match is returned; the blank-tile handling decides which one really has data.
 */
export function sourcesAt(lng, lat, zoom) {
  const rank = (s) => parseFloat(String(s.resolution).replace(/[^\d.]/g, '')) || 999;
  return HIRES_SOURCES
    .filter((s) => inBounds(s.bounds, lng, lat) && zoom >= s.minzoom)
    .sort((a, b) => rank(a) - rank(b));
}

/** Draw order: larger regions first, so smaller (usually sharper) ones sit on top. */
export function drawOrder() {
  const area = (s) => (s.bounds[2] - s.bounds[0]) * (s.bounds[3] - s.bounds[1]);
  return [...HIRES_SOURCES].sort((a, b) => area(b) - area(a));
}

/** Centre of an XYZ tile as [lng, lat]. */
export function tileCenterLngLat(z, x, y) {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/**
 * Remembers where each source really delivered imagery, so "what is on screen"
 * stays right when MapLibre redraws from its own tile cache (no handler call).
 */
export function createCoverageMemory({ perSource = 300 } = {}) {
  const pts = new Map(); // id -> [[lng, lat], ...] most recent last
  return {
    record(id, z, x, y) {
      if (![z, x, y].every(Number.isFinite)) return;
      const arr = pts.get(id) ?? [];
      arr.push(tileCenterLngLat(z, x, y));
      if (arr.length > perSource) arr.shift();
      pts.set(id, arr);
    },
    /** ids with imagery recorded inside {west,south,east,north} */
    inView(b) {
      const out = [];
      for (const [id, arr] of pts) {
        if (arr.some(([lng, lat]) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north)) out.push(id);
      }
      return out;
    },
  };
}

export const hiresSourceId = (s) => `hires-${s.id}`;
export const hiresLayerId = (s) => `hires-layer-${s.id}`;

/** MapLibre sources + layers for buildStyle(). */
export function hiresStyleParts({ visible = true } = {}) {
  const sources = {};
  const layers = [];
  for (const s of drawOrder()) {
    sources[hiresSourceId(s)] = {
      type: 'raster',
      tiles: [`hires://${s.id}/{z}/{x}/{y}`],
      tileSize: 256,
      bounds: s.bounds,
      minzoom: 0,
      maxzoom: s.maxzoom,
      // No `attribution` here on purpose: MapLibre would list all providers at
      // once. map.js shows only the ones really on screen (setHiresCredits).
    };
    layers.push({
      id: hiresLayerId(s),
      type: 'raster',
      source: hiresSourceId(s),
      minzoom: s.minzoom,
      layout: { visibility: visible ? 'visible' : 'none' },
    });
  }
  return { sources, layers };
}

// ---- tile handler (browser) -------------------------------------------------

async function looksBlank(buffer) {
  try {
    const bmp = await createImageBitmap(new Blob([buffer]));
    const N = 16;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, N, N);
    bmp.close?.();
    return isBlankPixels(ctx.getImageData(0, 0, N, N).data);
  } catch (_) {
    return false; // cannot tell: show the tile
  }
}

/**
 * Register the `hires://` protocol. Every outcome except a real photo becomes a
 * transparent tile, so the base map shows through instead of white or an error.
 */
export function registerHiresProtocol(maplibregl, { fetchImpl = globalThis.fetch, onResult } = {}) {
  // onResult({ id, real }) tells the UI which source actually delivered imagery,
  // because a bounding rectangle also covers parts of neighbouring countries.
  const report = (id, real, p) => { try { onResult?.({ id, real, z: p?.z, x: p?.x, y: p?.y }); } catch (_) { /* UI hook must never break tile loading */ } };
  maplibregl.addProtocol('hires', async (params, abortController) => {
    const p = parseHiresUrl(params.url);
    const src = p && hiresSource(p.id);
    if (!src) return { data: transparentPng() };
    try {
      const res = await fetchImpl(tileUrl(src, p.z, p.x, p.y), { signal: abortController?.signal });
      if (!res.ok) { report(src.id, false, p); return { data: transparentPng() }; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < BLANK_CHECK_MAX_BYTES && (await looksBlank(buf))) { report(src.id, false, p); return { data: transparentPng() }; }
      report(src.id, true, p);
      return { data: buf };
    } catch (err) {
      if (abortController?.signal?.aborted) throw err; // a cancelled request is not a failure
      report(src.id, false, p);
      return { data: transparentPng() };
    }
  });
}
