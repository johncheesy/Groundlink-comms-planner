/**
 * Meta / WRI canopy height (CHM v2, ~1.2 m) — worker-safe sampler.
 *
 * Source: the Taylor Geospatial CORS mirror on source.coop
 * (`data.source.coop/tge-labs/meta-chm-v2`, CC-BY-4.0). One COG per zoom-10
 * Web-Mercator tile, named by its quadkey (`chm/{quadkey}.tif`), EPSG:3857,
 * uint8 metres (0 = no canopy or no data). Each COG carries overviews down to
 * 512 px, so we read only the level that matches the run's resolution — a
 * 40 km area reads ~38 m pixels, never the 1.2 m base. Tiles that don't exist
 * (open ocean) answer 404 and count as no canopy. Areas wider than MAX_TILES
 * tiles get no canopy layer: the mirror's global overview (~611 m) averages
 * forest down to a few metres, which would make clutter lower than the
 * WorldCover table it replaces.
 *
 * `buildCanopy(bounds)` → `{ id, heightM(lng, lat) }`, or throws (callers
 * then keep the WorldCover class heights).
 */

const BASE = 'https://data.source.coop/tge-labs/meta-chm-v2';
const Z = 10;
const R = 6378137;
const HALF = Math.PI * R; // half the Web-Mercator world width (m)
const TILE_M = (2 * HALF) / 2 ** Z; // one zoom-10 tile (m, mercator)
const MAX_TILES = 48;
const TARGET_PX = 1024; // pixels across the longer side of the area
// Finest level we read: the 1024 px overview (~38 m mercator, ~23 m on the
// ground at 52°). P.1812 wants a representative clutter height, not single
// trees, and finer levels cost several slow uncached range reads per tile.
const MIN_PIXEL_M = TILE_M / 1024;
const MAX_CANOPY_M = 50; // towers/artefacts in the source reach 70+ m
const TIMEOUT_MS = 20000;

const geotiff = () => import('geotiff');

export const mercX = (lng) => ((lng * Math.PI) / 180) * R;
export function mercY(lat) {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return 0.5 * R * Math.log((1 + s) / (1 - s));
}

/** Bing quadkey for tile (x, y) at zoom z. */
export function quadkey(x, y, z = Z) {
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

const tileX = (mx) => Math.floor((mx + HALF) / TILE_M);
const tileY = (my) => Math.floor((HALF - my) / TILE_M);

/** Zoom-10 tile range covering a lng/lat bbox (inclusive). */
export function chmTileRange({ west, south, east, north }) {
  const minX = tileX(mercX(west));
  const maxX = tileX(mercX(east) - 1e-6);
  const minY = tileY(mercY(north));
  const maxY = tileY(mercY(south) + 1e-6);
  return { minX, maxX, minY, maxY, count: (maxX - minX + 1) * (maxY - minY + 1) };
}

/**
 * Pick the coarsest level whose pixel is still at least as fine as `targetM`
 * (falls back to the finest). `widths` are pixel widths of a raster spanning
 * `spanM` mercator metres, any order. Pure.
 */
export function pickLevel(widths, spanM, targetM) {
  let best = -1;
  let finest = 0;
  widths.forEach((w, i) => {
    if (w > widths[finest]) finest = i;
    if (spanM / w <= targetM && (best < 0 || w < widths[best])) best = i;
  });
  return best < 0 ? finest : best;
}

// One 256 KB block holds every IFD of a tile COG and a typical read window,
// so opening + reading takes ~2 requests instead of ~25 with the 64 KB default
// (which made walking the IFDs alone a dozen sequential round trips).
const BLOCK_SIZE = 262144;

/**
 * Read the part of one EPSG:3857 COG that overlaps mercator bbox `mb`, at
 * roughly `targetM` metres per pixel. Returns a grid, or null when the file
 * doesn't exist (404).
 */
async function readWindow(url, mb, targetM) {
  let tiff;
  try {
    tiff = await (await geotiff()).fromUrl(url, { allowFullFile: false, blockSize: BLOCK_SIZE });
    await tiff.getImage(0); // forces the first read
  } catch (err) {
    // geotiff.js hides the HTTP status: a 1-byte probe tells "no tile here"
    // (404, open ocean) apart from a real failure.
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    if (probe?.status === 404) return null;
    throw err;
  }
  // Levels differ per file (some carry 1-bit masks between them), so list
  // them; the IFDs all sit in the first block, so this costs no extra reads.
  const images = [];
  for (let i = 0, n = await tiff.getImageCount(); i < n; i++) {
    const img = await tiff.getImage(i);
    if ((img.fileDirectory.BitsPerSample?.[0] ?? 8) === 8) images.push(img);
  }
  const [bx0, by0, bx1, by1] = images[0].getBoundingBox();
  const ext = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  const im = images[pickLevel(images.map((x) => x.getWidth()), ext.x1 - ext.x0, targetM)];
  const W = im.getWidth();
  const H = im.getHeight();
  const sx = W / (ext.x1 - ext.x0);
  const sy = H / (ext.y1 - ext.y0);
  const x0 = Math.max(0, Math.floor((Math.max(mb.x0, ext.x0) - ext.x0) * sx));
  const x1 = Math.min(W, Math.ceil((Math.min(mb.x1, ext.x1) - ext.x0) * sx));
  const y0 = Math.max(0, Math.floor((ext.y1 - Math.min(mb.y1, ext.y1)) * sy));
  const y1 = Math.min(H, Math.ceil((ext.y1 - Math.max(mb.y0, ext.y0)) * sy));
  if (x1 <= x0 || y1 <= y0) return null;
  const [data] = await im.readRasters({ window: [x0, y0, x1, y1], samples: [0] });
  return {
    data,
    w: x1 - x0,
    h: y1 - y0,
    x0: ext.x0 + x0 / sx, // window extent in mercator metres
    y1: ext.y1 - y0 / sy,
    sx,
    sy,
  };
}

const gridValue = (gr, mx, my) => {
  const c = Math.floor((mx - gr.x0) * gr.sx);
  const r = Math.floor((gr.y1 - my) * gr.sy);
  if (c < 0 || r < 0 || c >= gr.w || r >= gr.h) return 0;
  return Math.min(MAX_CANOPY_M, gr.data[r * gr.w + c]);
};

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(Object.assign(new Error('canopy timed out'), { reason: 'timeout' })), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function build(bounds) {
  const mb = { x0: mercX(bounds.west), x1: mercX(bounds.east), y0: mercY(bounds.south), y1: mercY(bounds.north) };
  const targetM = Math.max(MIN_PIXEL_M, Math.max(mb.x1 - mb.x0, mb.y1 - mb.y0) / TARGET_PX);
  const range = chmTileRange(bounds);

  if (range.count > MAX_TILES) {
    throw Object.assign(new Error(`area needs ${range.count} canopy tiles (max ${MAX_TILES})`), { reason: 'too-large' });
  }

  const cols = range.maxX - range.minX + 1;
  const jobs = [];
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      jobs.push(readWindow(`${BASE}/chm/${quadkey(x, y)}.tif`, mb, targetM));
    }
  }
  const grids = await Promise.all(jobs); // row-major over the tile range
  return {
    id: 'chm',
    heightM(lng, lat) {
      const mx = mercX(lng);
      const my = mercY(lat);
      const tx = tileX(mx) - range.minX;
      const ty = tileY(my) - range.minY;
      if (tx < 0 || ty < 0 || tx >= cols || ty > range.maxY - range.minY) return 0;
      const gr = grids[ty * cols + tx];
      return gr ? gridValue(gr, mx, my) : 0;
    },
  };
}

/** Canopy-height sampler for a lng/lat bbox. Throws on failure or time-out. */
export function buildCanopy(bounds) {
  return withTimeout(build(bounds), TIMEOUT_MS);
}
