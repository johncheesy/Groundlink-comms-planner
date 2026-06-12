/**
 * Cloud-Optimized GeoTIFF reading (E1) — worker-safe, via geotiff.js.
 *
 * Opens a COG from a URL (HTTP byte-range reads, CORS required) or a local
 * File/Blob (no network, no CORS — the OPSEC-clean path: the file never
 * leaves the browser), picks the overview level that matches the requested
 * window resolution, reads ONE window covering the bbox, and exposes a sync
 * `sample(lng, lat)` over that grid — the same prefetch-window pattern the
 * Terrarium DEM sampler uses, so the coverage sweep stays synchronous.
 *
 * Assumes geographic (EPSG:4326-style, north-up) rasters — true for the E1
 * reference datasets (Copernicus GLO-30, ESA WorldCover, canopy-height COGs).
 *
 * Graceful degradation: any failure (404, CORS, malformed file) logs once per
 * source and returns null — callers fall back to the neutral value; the plot
 * never hard-fails (spec §B).
 */

// geotiff loads lazily on the first COG open: its core (+fflate) is ~120 kB
// minified that only COG users pay for — statically it sat in the main app
// chunk (the coverage worker has its own bundle and pays it either way).
const geotiff = () => import('geotiff');

// fromBlob slices lazily via FileReader (browser-only). Under node/vitest
// FileReader is absent — read the whole blob instead (tests use tiny tiffs).
const openBlob = (b) =>
  typeof FileReader === 'undefined'
    ? b.arrayBuffer().then(async (buf) => (await geotiff()).fromArrayBuffer(buf))
    : geotiff().then((g) => g.fromBlob(b));

/** Tiny LRU used for read windows; exported for tests. */
export function createLru(max = 8) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key); // re-insert → most recent
      map.set(key, v);
      return v;
    },
    set(key, v) {
      if (map.has(key)) map.delete(key);
      map.set(key, v);
      if (map.size > max) map.delete(map.keys().next().value);
    },
    size: () => map.size,
    has: (key) => map.has(key),
  };
}

/**
 * Pick the smallest image level that still resolves the bbox at ≥ maxDim
 * pixels across its larger axis (levels[0] = full resolution; overviews
 * follow, each smaller). Pure — tested against fixtures.
 *
 * @param levels   [{ width, height }] in geotiff image order
 * @param bbox     { west, south, east, north } requested window
 * @param dataBbox [west, south, east, north] of the full image
 */
export function pickOverview(levels, bbox, dataBbox, maxDim = 512) {
  const [dw, ds, de, dn] = dataBbox;
  const fracX = Math.min(1, Math.max(0, (bbox.east - bbox.west) / Math.max(de - dw, 1e-12)));
  const fracY = Math.min(1, Math.max(0, (bbox.north - bbox.south) / Math.max(dn - ds, 1e-12)));
  for (let i = levels.length - 1; i >= 0; i--) {
    const px = Math.max(levels[i].width * fracX, levels[i].height * fracY);
    if (px >= maxDim || i === 0) return i;
  }
  return 0;
}

/**
 * Pixel window [x0, y0, x1, y1] (north-up image) covering bbox at a level of
 * `width`×`height` pixels spanning dataBbox. Clamped, ≥ 1 px each axis. Pure.
 */
export function windowFor(bbox, dataBbox, width, height) {
  const [dw, ds, de, dn] = dataBbox;
  const sx = width / (de - dw);
  const sy = height / (dn - ds);
  let x0 = Math.floor((bbox.west - dw) * sx);
  let x1 = Math.ceil((bbox.east - dw) * sx);
  let y0 = Math.floor((dn - bbox.north) * sy); // north edge → row 0
  let y1 = Math.ceil((dn - bbox.south) * sy);
  x0 = Math.max(0, Math.min(width - 1, x0));
  y0 = Math.max(0, Math.min(height - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(width, x1));
  y1 = Math.max(y0 + 1, Math.min(height, y1));
  return [x0, y0, x1, y1];
}

/**
 * Sync sampler over one decoded window. Bilinear for continuous data
 * (elevation/heights); set interpolate:false for categorical rasters.
 * Outside the window (or on noData) returns `neutral`. Pure — tested.
 *
 * @param grid { data: TypedArray, width, height, bbox: {west,south,east,north} }
 */
export function makeGridSampler(grid, { neutral = 0, noData = null, interpolate = true } = {}) {
  const { data, width, height, bbox } = grid;
  const sx = width / (bbox.east - bbox.west);
  const sy = height / (bbox.north - bbox.south);
  const val = (x, y) => {
    const v = data[y * width + x];
    return v == null || Number.isNaN(v) || (noData != null && v === noData) ? null : v;
  };
  return {
    sample(lng, lat) {
      const fx = (lng - bbox.west) * sx - 0.5;
      const fy = (bbox.north - lat) * sy - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > width - 0.5 || fy > height - 0.5) return neutral;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
      if (!interpolate) {
        const v = val(Math.round(Math.max(0, Math.min(width - 1, fx))), Math.round(Math.max(0, Math.min(height - 1, fy))));
        return v ?? neutral;
      }
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const dx = Math.max(0, Math.min(1, fx - x0));
      const dy = Math.max(0, Math.min(1, fy - y0));
      const a = val(x0, y0);
      const b = val(x1, y0);
      const c = val(x0, y1);
      const d = val(x1, y1);
      if (a == null && b == null && c == null && d == null) return neutral;
      // Treat missing corners as the mean of present ones (edge of data).
      const present = [a, b, c, d].filter((v) => v != null);
      const mean = present.reduce((s, v) => s + v, 0) / present.length;
      const A = a ?? mean, B = b ?? mean, C = c ?? mean, D = d ?? mean;
      return A * (1 - dx) * (1 - dy) + B * dx * (1 - dy) + C * (1 - dx) * dy + D * dx * dy;
    },
  };
}

// One opened tiff + window cache per source; failures logged once per source.
// URLs cache by string; Blobs/Files by OBJECT IDENTITY (a WeakMap) — name and
// size are not unique (e.g. a re-exported file with the same name), and the
// identity key also lets a replaced File drop its stale grids naturally.
const urlTiffCache = new Map(); // url → Promise<GeoTIFF>
const blobTiffCache = new WeakMap(); // Blob → Promise<GeoTIFF>
const windowCache = createLru(8); // `${label}|${seq}|${level}|${window}` → grid
const failedUrls = new Set();
const failedBlobs = new WeakSet();
let blobSeq = 0; // distinguishes window-cache entries across distinct blobs
const blobSeqs = new WeakMap();

const sourceLabel = (src) => (typeof src === 'string' ? src : `file:${src.name ?? 'local'}`);

function tiffFor(source) {
  if (typeof source === 'string') {
    if (!urlTiffCache.has(source)) urlTiffCache.set(source, geotiff().then((g) => g.fromUrl(source)));
    return urlTiffCache.get(source);
  }
  if (!blobTiffCache.has(source)) {
    blobTiffCache.set(source, openBlob(source));
    blobSeqs.set(source, ++blobSeq);
  }
  return blobTiffCache.get(source);
}

const hasFailed = (src) => (typeof src === 'string' ? failedUrls.has(src) : failedBlobs.has(src));
const markFailed = (src) => (typeof src === 'string' ? failedUrls.add(src) : failedBlobs.add(src));

/**
 * Build a sync sampler over `bounds` from a COG (URL string or File/Blob).
 * Returns null on any failure (logged once); never throws to the caller.
 */
export async function buildCogSampler(source, bounds, { maxDim = 512, neutral = 0, interpolate = true } = {}) {
  if (hasFailed(source)) return null;
  try {
    const tiff = await tiffFor(source);
    const count = await tiff.getImageCount();
    const full = await tiff.getImage(0);
    const dataBbox = full.getBoundingBox(); // [west, south, east, north]
    const levels = [{ width: full.getWidth(), height: full.getHeight() }];
    const images = [full];
    for (let i = 1; i < count; i++) {
      const img = await tiff.getImage(i);
      levels.push({ width: img.getWidth(), height: img.getHeight() });
      images.push(img);
    }
    const li = pickOverview(levels, bounds, dataBbox, maxDim);
    const win = windowFor(bounds, dataBbox, levels[li].width, levels[li].height);
    const seq = typeof source === 'string' ? source : `b${blobSeqs.get(source)}`;
    const cacheKey = `${seq}|${li}|${win.join(',')}`;
    let grid = windowCache.get(cacheKey);
    if (!grid) {
      const rasters = await images[li].readRasters({ window: win, samples: [0], fillValue: NaN });
      const noDataStr = full.getGDALNoData?.();
      const [dw, ds, de, dn] = dataBbox;
      const W = levels[li].width;
      const H = levels[li].height;
      grid = {
        data: rasters[0],
        width: win[2] - win[0],
        height: win[3] - win[1],
        bbox: {
          west: dw + (win[0] / W) * (de - dw),
          east: dw + (win[2] / W) * (de - dw),
          north: dn - (win[1] / H) * (dn - ds),
          south: dn - (win[3] / H) * (dn - ds),
        },
        noData: noDataStr == null ? null : Number(noDataStr),
      };
      windowCache.set(cacheKey, grid);
    }
    return makeGridSampler(grid, { neutral, noData: grid.noData, interpolate });
  } catch (err) {
    markFailed(source);
    console.warn(`[groundlink] COG source unavailable (${sourceLabel(source)}):`, err?.message ?? err);
    return null;
  }
}

/** Test/HMR hook: forget cached URL opens and failures (blob caches are weak). */
export function resetCogCaches() {
  urlTiffCache.clear();
  failedUrls.clear();
}
