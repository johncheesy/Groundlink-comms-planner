/**
 * Offline AOI packaging (E1 §D) — fetch the Terrarium DEM tiles covering an
 * AOI and write them as a single **PMTiles v3 archive into OPFS**, plus a
 * manifest, so later sessions sample elevation fully offline.
 *
 * OPSEC: the packaged area reveals the user's AOI, so it lives in OPFS only
 * (origin-private, local disk), is written on an explicit user action, and is
 * never uploaded. Reading works in workers too (navigator.storage is
 * available in dedicated workers), so the coverage sweep itself goes offline.
 *
 * The writer emits a minimal spec-compliant PMTiles v3: 127-byte header,
 * uncompressed internal directories (compression type 1 = none — PNG tile
 * data is already compressed), Hilbert tile IDs via the pmtiles lib, entries
 * clustered in tileId order. Readable by the same `pmtiles` lib that backs
 * the MapLibre protocol — one reader for remote and offline archives.
 */

import { PMTiles, zxyToTileId } from 'pmtiles';

const DIR_NAME = 'groundlink-offline';
const PACK_FILE = 'terrarium.pmtiles';
const MANIFEST_FILE = 'manifest.json';
const TERRARIUM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const MAX_PACK_TILES = 600; // ~150 MB worst case; keep deliberate

/* ------------------------------------------------------------------ */
/* Tile math (pure, tested)                                            */
/* ------------------------------------------------------------------ */

const lon2tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Enumerate the XYZ tiles covering bounds for the zoom list, capped at
 * `maxTiles` (drops the highest zooms first — coarse coverage beats none).
 */
export function tilesForBounds(bounds, zooms, maxTiles = MAX_PACK_TILES) {
  const out = [];
  const sorted = [...zooms].sort((a, b) => a - b);
  for (const z of sorted) {
    const x0 = lon2tileX(bounds.west, z);
    const x1 = lon2tileX(bounds.east, z);
    const y0 = lat2tileY(bounds.north, z);
    const y1 = lat2tileY(bounds.south, z);
    const level = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) level.push({ z, x, y });
    if (out.length + level.length > maxTiles) break;
    out.push(...level);
  }
  return out;
}

/** Does the packaged manifest fully cover the requested bounds? Pure. */
export function manifestCovers(manifest, bounds) {
  const b = manifest?.bounds;
  if (!b) return false;
  return b.west <= bounds.west && b.east >= bounds.east && b.south <= bounds.south && b.north >= bounds.north;
}

/* ------------------------------------------------------------------ */
/* PMTiles v3 writer (pure, tested against the pmtiles reader)         */
/* ------------------------------------------------------------------ */

function varint(n, bytes) {
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
}

/**
 * Serialize tiles into a PMTiles v3 ArrayBuffer.
 * @param tiles [{ z, x, y, data: Uint8Array }] — PNG (or any) payloads
 * @param meta  { tileType?: number, minZoom, maxZoom, bounds }  tileType 2=png
 */
export function writePmtiles(tiles, { tileType = 2, minZoom, maxZoom, bounds } = {}) {
  if (!tiles.length) throw new Error('writePmtiles: no tiles');
  const entries = tiles
    .map((t) => ({ tileId: zxyToTileId(t.z, t.x, t.y), data: t.data }))
    .sort((a, b) => a.tileId - b.tileId);

  // Tile data section (clustered: same order as the sorted directory).
  let offset = 0;
  const withOffsets = entries.map((e) => {
    const rec = { tileId: e.tileId, offset, length: e.data.length, data: e.data };
    offset += e.data.length;
    return rec;
  });

  // Root directory: varint-encoded — count, then delta tileIds, run lengths,
  // lengths, then offsets in the explicit `offset + 1` form (the 0 shorthand
  // for "contiguous" is only valid after the first entry; explicit is always
  // valid and what the reference reader decodes as v − 1).
  const dir = [];
  varint(withOffsets.length, dir);
  let prevId = 0;
  for (const e of withOffsets) { varint(e.tileId - prevId, dir); prevId = e.tileId; }
  for (let i = 0; i < withOffsets.length; i++) varint(1, dir); // run lengths
  for (const e of withOffsets) varint(e.length, dir);
  for (const e of withOffsets) varint(e.offset + 1, dir);
  const rootDir = new Uint8Array(dir);

  const metadata = new TextEncoder().encode(JSON.stringify({ generator: 'groundlink-e1' }));

  const HEADER = 127;
  const rootOff = HEADER;
  const metaOff = rootOff + rootDir.length;
  const leafOff = metaOff + metadata.length;
  const tileOff = leafOff; // no leaf directories
  const total = tileOff + offset;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0); // "PMTiles"
  v.setUint8(7, 3); // spec version
  const set64 = (at, n) => v.setBigUint64(at, BigInt(n), true);
  set64(8, rootOff); set64(16, rootDir.length);
  set64(24, metaOff); set64(32, metadata.length);
  set64(40, leafOff); set64(48, 0); // no leaves
  set64(56, tileOff); set64(64, offset);
  set64(72, withOffsets.length); // addressed tiles
  set64(80, withOffsets.length); // tile entries
  set64(88, withOffsets.length); // tile contents
  v.setUint8(96, 1); // clustered
  v.setUint8(97, 1); // internal compression: none
  v.setUint8(98, 1); // tile compression: none
  v.setUint8(99, tileType);
  v.setUint8(100, minZoom ?? tiles[0].z);
  v.setUint8(101, maxZoom ?? tiles[tiles.length - 1].z);
  const e7 = (deg) => Math.round(deg * 1e7);
  v.setInt32(102, e7(bounds?.west ?? -180), true);
  v.setInt32(106, e7(bounds?.south ?? -85), true);
  v.setInt32(110, e7(bounds?.east ?? 180), true);
  v.setInt32(114, e7(bounds?.north ?? 85), true);
  v.setUint8(118, minZoom ?? tiles[0].z); // center zoom
  v.setInt32(119, e7(((bounds?.west ?? 0) + (bounds?.east ?? 0)) / 2), true);
  v.setInt32(123, e7(((bounds?.south ?? 0) + (bounds?.north ?? 0)) / 2), true);

  u8.set(rootDir, rootOff);
  u8.set(metadata, metaOff);
  for (const e of withOffsets) u8.set(e.data, tileOff + e.offset);
  return buf;
}

/** pmtiles-lib Source over a Blob/File (OPFS or in-memory) — no network. */
export class BlobSource {
  constructor(blob, key = 'blob') {
    this.blob = blob;
    this.key = key;
  }
  getKey() { return this.key; }
  async getBytes(offset, length) {
    const data = await this.blob.slice(offset, offset + length).arrayBuffer();
    return { data };
  }
}

/* ------------------------------------------------------------------ */
/* OPFS store (browser/worker only — guarded)                          */
/* ------------------------------------------------------------------ */

async function opfsDir(create = false) {
  if (!globalThis.navigator?.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create });
  } catch {
    return null;
  }
}

/** Read the offline manifest, or null when nothing is packaged. */
export async function readManifest() {
  const dir = await opfsDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(MANIFEST_FILE);
    return JSON.parse(await (await fh.getFile()).text());
  } catch {
    return null;
  }
}

/** Delete the packaged AOI (file + manifest). */
export async function clearOfflinePack() {
  const dir = await opfsDir();
  if (!dir) return;
  for (const name of [PACK_FILE, MANIFEST_FILE]) {
    try { await dir.removeEntry(name); } catch { /* absent */ }
  }
}

/**
 * Package the DEM tiles for `bounds` into OPFS. Explicit user action only
 * (spec §D). Returns the manifest, or null when OPFS is unavailable.
 */
export async function packageAoi(bounds, { zooms = [8, 9, 10, 11], onProgress } = {}) {
  const dir = await opfsDir(true);
  if (!dir) return null;
  const list = tilesForBounds(bounds, zooms);
  if (!list.length) throw new Error('AOI too large to package — zoom levels exceed the tile budget');
  const tiles = [];
  let done = 0;
  for (const t of list) {
    try {
      const r = await fetch(TERRARIUM_URL(t.z, t.x, t.y));
      if (r.ok) tiles.push({ ...t, data: new Uint8Array(await r.arrayBuffer()) });
    } catch { /* missing tile (ocean/edge) — sampler treats as 0 */ }
    done += 1;
    onProgress?.(done / list.length);
  }
  if (!tiles.length) throw new Error('No DEM tiles could be fetched — offline package not written');

  const packed = writePmtiles(tiles, {
    tileType: 2,
    minZoom: Math.min(...tiles.map((t) => t.z)),
    maxZoom: Math.max(...tiles.map((t) => t.z)),
    bounds,
  });
  const manifest = {
    v: 1,
    dataset: 'terrarium',
    bounds,
    zooms: [...new Set(tiles.map((t) => t.z))].sort((a, b) => a - b),
    tiles: tiles.length,
    bytes: packed.byteLength,
    created: new Date().toISOString(),
  };

  const packFh = await dir.getFileHandle(PACK_FILE, { create: true });
  let w = await packFh.createWritable();
  await w.write(packed);
  await w.close();
  const manFh = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  w = await manFh.createWritable();
  await w.write(JSON.stringify(manifest));
  await w.close();
  return manifest;
}

/**
 * Tile getter backed by the OPFS package: (z, x, y) → Blob | null.
 * Returns null when nothing is packaged or the manifest doesn't cover bounds —
 * callers fall through to the network path.
 */
export async function offlineTileGetter(bounds) {
  const manifest = await readManifest();
  if (!manifest || !manifestCovers(manifest, bounds)) return null;
  const dir = await opfsDir();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(PACK_FILE)).getFile();
    const pm = new PMTiles(new BlobSource(file, 'groundlink-offline'));
    return {
      manifest,
      zooms: manifest.zooms,
      async getTile(z, x, y) {
        const res = await pm.getZxy(z, x, y);
        return res?.data ? new Blob([res.data]) : null;
      },
    };
  } catch {
    return null;
  }
}
