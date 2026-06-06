/**
 * Worker-safe DEM (digital elevation model) sampler.
 *
 * Fetches AWS Terrarium raster-DEM tiles covering a bbox, decodes them into a
 * single elevation mosaic via OffscreenCanvas, and exposes a bilinear
 * `sample(lng, lat) -> metres`. Token-free; CORS-enabled open data.
 *
 * Terrarium encoding: elevation = (R*256 + G + B/256) - 32768  (metres).
 *
 * Used inside the coverage worker, so it must avoid any DOM/window APIs —
 * `fetch`, `createImageBitmap` and `OffscreenCanvas` are available in workers.
 */

const TILE = 256;
const TERRARIUM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lon2tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** Choose a tile zoom that spans ~2–3 tiles across the bbox (cap fetch count). */
export function pickZoom(bounds) {
  const ewDeg = Math.max(Math.abs(bounds.east - bounds.west), 1e-4);
  const z = Math.round(Math.log2(720 / ewDeg)); // ~2 tiles across
  return Math.max(7, Math.min(12, z));
}

/**
 * Build an elevation sampler for the bbox. Returns null if no DEM tile could be
 * fetched (caller falls back to flat earth).
 */
export async function buildDem(bounds, z = pickZoom(bounds)) {
  const minX = Math.floor(lon2tileX(bounds.west, z));
  const maxX = Math.floor(lon2tileX(bounds.east, z));
  const minY = Math.floor(lat2tileY(bounds.north, z)); // north → smaller y
  const maxY = Math.floor(lat2tileY(bounds.south, z));
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const W = cols * TILE;
  const H = rows * TILE;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let drawn = 0;
  await Promise.all(
    Array.from({ length: cols * rows }, (_, i) => {
      const tx = minX + (i % cols);
      const ty = minY + Math.floor(i / cols);
      return fetch(TERRARIUM_URL(z, tx, ty))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`tile ${r.status}`))))
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          ctx.drawImage(bmp, (tx - minX) * TILE, (ty - minY) * TILE);
          bmp.close?.();
          drawn += 1;
        })
        .catch(() => {}); // tolerate missing tiles (ocean / edge); stays 0 there
    }),
  );
  if (drawn === 0) return null;

  const data = ctx.getImageData(0, 0, W, H).data;
  const elevAtPx = (px, py) => {
    const x = Math.max(0, Math.min(W - 1, px));
    const y = Math.max(0, Math.min(H - 1, py));
    const o = (y * W + x) * 4;
    return data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
  };

  return {
    z,
    /** Bilinear elevation (m) at a geographic point. */
    sample(lng, lat) {
      const fx = (lon2tileX(lng, z) - minX) * TILE;
      const fy = (lat2tileY(lat, z) - minY) * TILE;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const dx = fx - x0;
      const dy = fy - y0;
      const a = elevAtPx(x0, y0);
      const b = elevAtPx(x0 + 1, y0);
      const c = elevAtPx(x0, y0 + 1);
      const d = elevAtPx(x0 + 1, y0 + 1);
      return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
    },
  };
}
