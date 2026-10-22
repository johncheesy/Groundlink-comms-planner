/**
 * Worker-safe DEM (digital elevation model) sampler.
 *
 * Fetches terrain tiles covering a bbox (Mapterhorn / Copernicus GLO-30 first,
 * AWS Terrarium per-tile fallback; see src/data/terrain-tiles.js), decodes each
 * tile on its own and exposes a bilinear `sample(lng, lat) -> metres`.
 *
 * Tiles are decoded one by one because neighbouring tiles can differ in size
 * (512 px primary, 256 px fallback) and Terrarium-encoded RGB must never be
 * scaled as an image: interpolating the colour channels produces nonsense
 * heights.
 *
 * Used inside the coverage worker, so no DOM/window APIs: `fetch`,
 * `createImageBitmap` and `OffscreenCanvas` exist in workers (and on the main
 * thread, where the path profile uses it too).
 */

import {
  fetchTerrainTile, decodeTerrarium, createMosaicSampler, sourceSummary, lon2tileX, lat2tileY,
} from '../data/terrain-tiles.js';

/** Choose a tile zoom that spans ~2–3 tiles across the bbox (cap fetch count). */
export function pickZoom(bounds) {
  const ewDeg = Math.max(Math.abs(bounds.east - bounds.west), 1e-4);
  const z = Math.round(Math.log2(720 / ewDeg)); // ~2 tiles across
  return Math.max(7, Math.min(12, z));
}

/** Default tile getter: network, primary source with per-tile fallback. */
const networkTile = (z, x, y) => fetchTerrainTile(z, x, y);

async function decodeBlob(blob) {
  // No colour management or premultiplication: they would alter the encoded values.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const w = bmp.width;
  const h = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { w, h, data: decodeTerrarium(ctx.getImageData(0, 0, w, h).data) };
}

/**
 * Build an elevation sampler for the bbox. Returns null if no tile could be
 * fetched (caller falls back to flat earth).
 *
 * @param getTile  optional (z, x, y) → Promise<Blob | {blob, source} | null>.
 *                 E1 injects the OPFS offline package here (plain Blobs);
 *                 the default is the network with fallback.
 * @returns {Promise<{ id: string, z: number, sample(lng, lat): number } | null>}
 */
export async function buildDem(bounds, z = pickZoom(bounds), getTile = networkTile) {
  const range = {
    minX: Math.floor(lon2tileX(bounds.west, z)),
    maxX: Math.floor(lon2tileX(bounds.east, z)),
    minY: Math.floor(lat2tileY(bounds.north, z)), // north → smaller y
    maxY: Math.floor(lat2tileY(bounds.south, z)),
  };
  const cols = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;

  const tiles = new Map();
  const sources = [];
  await Promise.all(
    Array.from({ length: cols * rows }, async (_, i) => {
      const tx = range.minX + (i % cols);
      const ty = range.minY + Math.floor(i / cols);
      try {
        const got = await getTile(z, tx, ty);
        if (!got) return;
        const blob = got instanceof Blob ? got : got.blob;
        const decoded = await decodeBlob(blob);
        tiles.set(`${tx},${ty}`, decoded);
        sources.push(got instanceof Blob ? 'offline' : got.source);
      } catch (_) { /* tolerate a missing or broken tile (sea / edge): it reads as 0 */ }
    }),
  );
  if (!tiles.size) return null;

  const sampler = createMosaicSampler({ z, tiles, range });
  return { id: sourceSummary(sources), z, sample: sampler.sample };
}
