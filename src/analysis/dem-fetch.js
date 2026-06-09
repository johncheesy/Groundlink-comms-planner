/**
 * Main-thread DEM sampler for path profiles (M14).
 *
 * The coverage worker has its own `buildDem` (src/workers/dem.js); a 100-point
 * profile is far too light to be worth a worker round-trip, so this duplicates
 * the same AWS Terrarium tile math on the main thread. Terrarium encoding:
 *   elevation = (R*256 + G + B/256) − 32768  (metres).
 * Token-free, CORS-enabled open data.
 */

const TILE = 256;
const TERRARIUM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lon2tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/**
 * Fetch a DEM covering both points and return an elevation sampler.
 * Zoom 10 is plenty for a cross-section; it is stepped down if the bbox would
 * span too many tiles (long path) so the fetch count stays bounded.
 *
 * @param {{ lat, lng }} a
 * @param {{ lat, lng }} b
 * @param {number} [steps] accepted for symmetry with buildPathProfile (unused —
 *                         the DEM is sampled at whatever density the caller wants)
 * @returns {Promise<{ z, sample(lng, lat): number } | null>} null if no tile loaded
 */
export async function fetchDemProfile(a, b, steps) {
  void steps;
  const west = Math.min(a.lng, b.lng);
  const east = Math.max(a.lng, b.lng);
  const north = Math.max(a.lat, b.lat);
  const south = Math.min(a.lat, b.lat);

  // Start at zoom 10, drop a level whenever the bbox would need too many tiles.
  let z = 10;
  let minX, maxX, minY, maxY, cols, rows;
  for (; z >= 6; z--) {
    minX = Math.floor(lon2tileX(west, z));
    maxX = Math.floor(lon2tileX(east, z));
    minY = Math.floor(lat2tileY(north, z)); // north → smaller y
    maxY = Math.floor(lat2tileY(south, z));
    cols = maxX - minX + 1;
    rows = maxY - minY + 1;
    if (cols * rows <= 16) break;
  }

  const W = cols * TILE;
  const H = rows * TILE;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let drawn = 0;
  await Promise.all(
    Array.from({ length: cols * rows }, (_, i) => {
      const tx = minX + (i % cols);
      const ty = minY + Math.floor(i / cols);
      return fetch(TERRARIUM_URL(z, tx, ty))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`tile ${r.status}`))))
        .then((b2) => createImageBitmap(b2))
        .then((bmp) => {
          ctx.drawImage(bmp, (tx - minX) * TILE, (ty - minY) * TILE);
          bmp.close?.();
          drawn += 1;
        })
        .catch(() => {}); // tolerate missing tiles (ocean / edge) — stays 0 there
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
      const e00 = elevAtPx(x0, y0);
      const e10 = elevAtPx(x0 + 1, y0);
      const e01 = elevAtPx(x0, y0 + 1);
      const e11 = elevAtPx(x0 + 1, y0 + 1);
      return (
        e00 * (1 - dx) * (1 - dy) +
        e10 * dx * (1 - dy) +
        e01 * (1 - dx) * dy +
        e11 * dx * dy
      );
    },
  };
}
