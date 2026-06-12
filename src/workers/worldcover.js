/**
 * Worker-safe ESA WorldCover 10 m land-cover sampler + clutter model.
 *
 * Source: ESA WorldCover 2021 via the Digital Earth Africa WMS (CORS-enabled,
 * CC-BY-4.0). One GetMap returns the whole AOI bbox in the classified palette;
 * we decode each pixel to a WorldCover class by nearest-palette match and
 * expose `sample(lng, lat) -> classId`. Africa coverage only — returns null
 * elsewhere / on failure so the caller falls back to no clutter.
 *
 * Clutter is applied as extra path-loss (dB) per land class; effective clutter
 * heights are tabulated for later profile refinement.
 */

const WMS = 'https://ows.digitalearth.africa/wms';

// WorldCover class → [r,g,b] palette (official discrete map colours).
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

function getMapUrl(bounds, W, H) {
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
  return `${WMS}?${p.toString()}`;
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

/**
 * Build a land-cover sampler for the bbox. Returns null on failure (caller
 * proceeds without clutter).
 */
export async function buildLandcover(bounds, size = 512) {
  const W = size;
  const H = size;
  try {
    const resp = await fetch(getMapUrl(bounds, W, H));
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!/image/.test(ct)) return null; // service exception XML, etc.
    const bmp = await createImageBitmap(await resp.blob());
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

    const { west, south, east, north } = bounds;
    const lngSpan = east - west || 1e-9;
    const latSpan = north - south || 1e-9;
    return {
      // Nearest-pixel class lookup (classes are discrete — no interpolation).
      sample(lng, lat) {
        const col = Math.max(0, Math.min(W - 1, Math.round(((lng - west) / lngSpan) * (W - 1))));
        const row = Math.max(0, Math.min(H - 1, Math.round(((north - lat) / latSpan) * (H - 1))));
        return grid[row * W + col];
      },
    };
  } catch {
    return null;
  }
}
