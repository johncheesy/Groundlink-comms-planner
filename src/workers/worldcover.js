/**
 * Worker-safe ESA WorldCover 10 m land-cover sampler + clutter model.
 *
 * Source (global): ESA WorldCover 2021 v200 via the Microsoft Planetary
 * Computer data API — no key, CORS `*`, CC-BY-4.0. WorldCover ships as
 * 3°×3° tiles; for each tile the AOI bbox touches we request one crop PNG
 * (`item/bbox/…png`). An uncoloured single-band crop comes back as grayscale,
 * so each pixel's grey value IS the WorldCover class (10, 20 … 100) — no
 * palette guessing. Tiles that don't exist (open ocean) answer 404 and stay
 * class 0 (no clutter).
 *
 * Fallback: the Digital Earth Africa WMS (palette PNG) when the AOI touches
 * Africa and Planetary Computer is unreachable.
 *
 * On failure `buildLandcover` throws a LandcoverError whose `reason` says why
 * ('timeout' | 'network' | 'http' | 'decode'), so the UI can tell the user
 * the truth instead of guessing.
 *
 * Clutter is applied as extra path-loss (dB) per land class; effective clutter
 * heights are the P.1812 profile input.
 */

const PC_BBOX = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox';
const PC_COLLECTION = 'esa-worldcover';
const DEA_WMS = 'https://ows.digitalearth.africa/wms';
const TIMEOUT_MS = 15000;

// WorldCover class → [r,g,b] palette (official discrete map colours) — only
// used to decode the DEA WMS fallback, which serves the coloured map.
const PALETTE = [
  [10, 0, 100, 0], // tree cover
  [20, 255, 187, 34], // shrubland
  [30, 255, 255, 76], // grassland
  [40, 240, 150, 255], // cropland
  [50, 250, 0, 0], // built-up
  [60, 180, 180, 180], // bare / sparse
  [70, 240, 240, 240], // snow / ice
  [80, 0, 100, 200], // permanent water
  [90, 0, 150, 160], // herbaceous wetland
  [95, 0, 207, 117], // mangrove
  [100, 250, 230, 160], // moss / lichen
];

/** class → { db: extra attenuation, h: effective clutter height (m) }. */
export const CLUTTER = {
  10: { db: 12, h: 20, label: 'Tree cover' },
  20: { db: 6, h: 4, label: 'Shrubland' },
  30: { db: 2, h: 1, label: 'Grassland' },
  40: { db: 3, h: 2, label: 'Cropland' },
  50: { db: 10, h: 8, label: 'Built-up' },
  60: { db: 0, h: 0, label: 'Bare / sparse' },
  70: { db: 0, h: 0, label: 'Snow / ice' },
  80: { db: 0, h: 0, label: 'Water' },
  90: { db: 4, h: 2, label: 'Wetland' },
  95: { db: 14, h: 15, label: 'Mangrove' },
  100: { db: 1, h: 0.5, label: 'Moss / lichen' },
};

export const clutterDbForClass = (cls) => CLUTTER[cls]?.db ?? 0;

/** Representative clutter height (m above ground) — the P.1812 profile input. */
export const clutterHeightForClass = (cls) => CLUTTER[cls]?.h ?? 0;

export class LandcoverError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'LandcoverError';
    this.reason = reason;
  }
}

/** One-line, user-facing explanation for a LandcoverError reason. */
export function landcoverReasonText(reason) {
  switch (reason) {
    case 'timeout': return 'the land-cover service took too long to answer';
    case 'network': return 'the land-cover service could not be reached (offline or blocked)';
    case 'http': return 'the land-cover service returned an error';
    case 'decode': return 'the land-cover data could not be read';
    default: return 'land-cover data was unavailable';
  }
}

const pad = (n, w) => String(Math.abs(n)).padStart(w, '0');

/** WorldCover tile id for the 3° tile whose south-west corner is (lat, lng). */
export function worldcoverItemId(lat, lng) {
  return `ESA_WorldCover_10m_2021_v200_${lat < 0 ? 'S' : 'N'}${pad(lat, 2)}${lng < 0 ? 'W' : 'E'}${pad(lng, 3)}`;
}

/**
 * The 3°×3° WorldCover tiles a bbox touches, each with the part of the bbox
 * that falls inside it.
 */
export function worldcoverTiles({ west, south, east, north }) {
  const tiles = [];
  const lat0 = Math.floor(south / 3) * 3;
  const lng0 = Math.floor(west / 3) * 3;
  for (let lat = lat0; lat < north; lat += 3) {
    for (let lng = lng0; lng < east; lng += 3) {
      const part = {
        west: Math.max(west, lng),
        south: Math.max(south, lat),
        east: Math.min(east, lng + 3),
        north: Math.min(north, lat + 3),
      };
      if (part.east > part.west && part.north > part.south) {
        tiles.push({ id: worldcoverItemId(lat, lng), ...part });
      }
    }
  }
  return tiles;
}

/**
 * Raster size for a bbox: the longer ground side gets `size` pixels, the other
 * side keeps the ground aspect ratio (so pixels are roughly square on the
 * ground at any latitude).
 */
export function rasterSize({ west, south, east, north }, size) {
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const wGround = Math.max(1e-9, (east - west) * k);
  const hGround = Math.max(1e-9, north - south);
  if (wGround >= hGround) return { W: size, H: Math.max(16, Math.round((size * hGround) / wGround)) };
  return { W: Math.max(16, Math.round((size * wGround) / hGround)), H: size };
}

/** Roughly Africa (incl. Madagascar) — where the DEA WMS fallback has data. */
const AFRICA = { west: -26, south: -36, east: 64, north: 38 };
const touchesAfrica = (b) =>
  b.west < AFRICA.east && b.east > AFRICA.west && b.south < AFRICA.north && b.north > AFRICA.south;

async function fetchImage(url) {
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new LandcoverError(timedOut ? 'timeout' : 'network', e?.message || String(e));
  }
  if (resp.status === 404) return null; // tile doesn't exist (open ocean)
  if (!resp.ok) throw new LandcoverError('http', `HTTP ${resp.status}`);
  const ct = resp.headers.get('content-type') || '';
  if (!/image/.test(ct)) throw new LandcoverError('http', `unexpected ${ct || 'response'}`);
  try {
    // Grey values are class ids — keep the bytes exactly as served.
    return await createImageBitmap(await resp.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
  } catch (e) {
    throw new LandcoverError('decode', e?.message || String(e));
  }
}

function sampler(grid, W, H, { west, south, east, north }) {
  const lngSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;
  return {
    // Nearest-pixel class lookup (classes are discrete — no interpolation).
    sample(lng, lat) {
      const col = Math.max(0, Math.min(W - 1, Math.floor(((lng - west) / lngSpan) * W)));
      const row = Math.max(0, Math.min(H - 1, Math.floor(((north - lat) / latSpan) * H)));
      return grid[row * W + col];
    },
  };
}

/** Planetary Computer: one grayscale crop per 3° tile, composited. */
async function buildFromPlanetaryComputer(bounds, size) {
  const { W, H } = rasterSize(bounds, size);
  const { west, north, east, south } = bounds;
  const pxX = (lng) => Math.round(((lng - west) / (east - west)) * W);
  const pxY = (lat) => Math.round(((north - lat) / (north - south)) * H);

  const parts = worldcoverTiles(bounds)
    .map((t) => ({ ...t, x: pxX(t.west), y: pxY(t.north), w: pxX(t.east) - pxX(t.west), h: pxY(t.south) - pxY(t.north) }))
    .filter((t) => t.w > 0 && t.h > 0);

  const bitmaps = await Promise.all(parts.map((t) => {
    const q = new URLSearchParams({ collection: PC_COLLECTION, item: t.id, assets: 'map' });
    return fetchImage(`${PC_BBOX}/${t.west},${t.south},${t.east},${t.north}/${t.w}x${t.h}.png?${q}`);
  }));
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  bitmaps.forEach((bmp, i) => {
    if (!bmp) return;
    const t = parts[i];
    ctx.drawImage(bmp, t.x, t.y, t.w, t.h);
    bmp.close?.();
  });

  const data = ctx.getImageData(0, 0, W, H).data;
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    grid[i] = data[o + 3] === 0 ? 0 : data[o]; // grey == class id
  }
  return sampler(grid, W, H, bounds);
}

function nearestClass(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (const [cls, pr, pg, pb] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cls;
    }
  }
  return best;
}

/** Digital Earth Africa WMS: coloured map, decoded by nearest palette match. */
async function buildFromDeaWms(bounds, size) {
  const { W, H } = rasterSize(bounds, size);
  const { west, south, east, north } = bounds;
  const p = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'esa_worldcover_2021',
    styles: '',
    crs: 'EPSG:4326', // WMS 1.3.0 axis order for EPSG:4326 is lat,lon
    bbox: `${south},${west},${north},${east}`,
    width: String(W),
    height: String(H),
    format: 'image/png',
  });
  const bmp = await fetchImage(`${DEA_WMS}?${p}`);
  if (!bmp) throw new LandcoverError('http', 'HTTP 404');
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, W, H).data;
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    grid[i] = data[o + 3] === 0 ? 0 : nearestClass(data[o], data[o + 1], data[o + 2]);
  }
  return sampler(grid, W, H, bounds);
}

/**
 * Build a land-cover sampler `{ id, sample(lng, lat) → classId }` for the
 * bbox. Throws a LandcoverError when no source answers.
 */
export async function buildLandcover(bounds, size = 1024) {
  try {
    return { id: 'worldcover', ...(await buildFromPlanetaryComputer(bounds, size)) };
  } catch (err) {
    if (!touchesAfrica(bounds)) throw err;
    try {
      return { id: 'worldcover-dea', ...(await buildFromDeaWms(bounds, size)) };
    } catch {
      throw err; // report the primary source's failure
    }
  }
}
