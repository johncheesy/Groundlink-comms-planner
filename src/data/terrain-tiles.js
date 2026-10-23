/**
 * Terrain (elevation) tiles: which source, how to fetch, how to decode.
 * Worker-safe: no DOM. Used by the coverage worker, the drone envelope worker,
 * the path profile and the offline packager, so they all see the same terrain.
 *
 * Primary: Mapterhorn (https://mapterhorn.com). Keyless, CORS, Terrarium
 * encoding in lossless WebP, 512 px tiles. Up to zoom 12 it is Copernicus
 * GLO-30 everywhere: a 30 m SURFACE model (2011-2015 TanDEM-X), newer and
 * sharper than the SRTM-based AWS tiles (checked: Matterhorn 4441 m vs AWS
 * 4274 m, true 4478 m; Dead Sea -432 m vs -412 m).
 *
 * Why stop at zoom 12: above it Mapterhorn serves LiDAR in about 35 countries,
 * but that is bare-earth (DTM) almost everywhere. Without a global clutter
 * layer, dropping trees and buildings from the terrain would make coverage
 * optimistic. See docs/decisions/0007-terrain-mapterhorn.md.
 *
 * Fallback, per tile: AWS Terrarium (the previous source), because Mapterhorn
 * is volunteer-run with no published SLA.
 *
 * Terrarium encoding: elevation = R*256 + G + B/256 - 32768 (metres).
 */

export const TERRAIN_PRIMARY = Object.freeze({
  id: 'mapterhorn',
  maxzoom: 12,
  url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
  credit: 'Copernicus GLO-30 via Mapterhorn',
});

export const TERRAIN_FALLBACK = Object.freeze({
  id: 'terrarium',
  maxzoom: 15,
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  credit: 'AWS Terrain Tiles (SRTM-based)',
});

/** Human label for a sampler id such as "mapterhorn", "mapterhorn+terrarium", "offline". */
export function terrainCredit(id) {
  if (!id) return null;
  const parts = String(id).split('+');
  const names = parts.map((p) => (p === 'mapterhorn' ? TERRAIN_PRIMARY.credit
    : p === 'lidar' ? 'bare-earth LiDAR via Mapterhorn'
    : p === 'terrarium' ? TERRAIN_FALLBACK.credit
      : p === 'offline' ? 'offline package'
        : p === 'cog' ? 'your elevation file' : p));
  return [...new Set(names)].join(' + ');
}

/**
 * Fetch one terrain tile: primary first (within its zoom range), fallback on any
 * failure. Returns { blob, source } or null when neither has the tile (open sea
 * at some zooms, outages).
 */
export async function fetchTerrainTile(z, x, y, { fetchImpl = globalThis.fetch } = {}) {
  const tries = z <= TERRAIN_PRIMARY.maxzoom ? [TERRAIN_PRIMARY, TERRAIN_FALLBACK] : [TERRAIN_FALLBACK];
  for (const src of tries) {
    try {
      const r = await fetchImpl(src.url(z, x, y));
      if (r && r.ok) return { blob: await r.blob(), source: src.id };
    } catch (_) { /* try the next source */ }
  }
  return null;
}

/** Decode Terrarium RGBA pixels into metres. */
export function decodeTerrarium(rgba) {
  const n = Math.floor(rgba.length / 4);
  const out = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) out[i] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  return out;
}

const lon2tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export { lon2tileX, lat2tileY };

/**
 * Bilinear sampler over a set of decoded tiles that may differ in size
 * (512 px Mapterhorn next to a 256 px fallback tile). Each tile is read at its
 * own resolution; neighbours across a tile edge are looked up in their own
 * tile. Encoded RGB must never be resampled as an image, which is why tiles
 * are decoded one by one instead of being drawn into one scaled canvas.
 *
 * @param {object} p
 * @param {number} p.z
 * @param {Map<string,{w:number,h:number,data:Float32Array}>} p.tiles  key "x,y"
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} p.range  tile range fetched
 */
export function createMosaicSampler({ z, tiles, range }) {
  const { minX, maxX, minY, maxY } = range;
  const EPS = 1e-9;
  const clampX = (t) => Math.min(maxX + 1 - EPS, Math.max(minX, t));
  const clampY = (t) => Math.min(maxY + 1 - EPS, Math.max(minY, t));
  const defW = (() => { for (const t of tiles.values()) return t.w; return 256; })();

  // Elevation at a point given in tile units (e.g. 2104.37), nearest pixel.
  const at = (tcx, tcy) => {
    const cx = clampX(tcx);
    const cy = clampY(tcy);
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const t = tiles.get(`${ix},${iy}`);
    if (!t) return 0; // missing tile (sea / outage): sea level, as before
    const px = Math.min(t.w - 1, Math.floor((cx - ix) * t.w));
    const py = Math.min(t.h - 1, Math.floor((cy - iy) * t.h));
    return t.data[py * t.w + px];
  };

  return {
    z,
    sample(lng, lat) {
      const tx = lon2tileX(lng, z);
      const ty = lat2tileY(lat, z);
      const here = tiles.get(`${Math.floor(clampX(tx))},${Math.floor(clampY(ty))}`);
      const w = here?.w ?? defW;
      const h = here?.h ?? defW;
      const fx = tx * w;
      const fy = ty * h;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const dx = fx - x0;
      const dy = fy - y0;
      // Pixel centres, expressed back in tile units so a neighbour may live in the next tile.
      const ux0 = (x0 + 0.5) / w;
      const ux1 = (x0 + 1.5) / w;
      const uy0 = (y0 + 0.5) / h;
      const uy1 = (y0 + 1.5) / h;
      const a = at(ux0, uy0);
      const b = at(ux1, uy0);
      const c = at(ux0, uy1);
      const d = at(ux1, uy1);
      return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
    },
  };
}

/** Summarise which sources supplied the tiles, e.g. "mapterhorn" or "mapterhorn+terrarium". */
export function sourceSummary(sources) {
  const order = ['cog', 'offline', 'mapterhorn', 'terrarium'];
  const set = new Set(sources);
  const ids = order.filter((s) => set.has(s)).concat([...set].filter((s) => !order.includes(s)));
  return ids.join('+') || null;
}
