/**
 * Minimal ZIP writer (stored / uncompressed) — no third-party library.
 *
 * KMZ and CivTAK data packages are just zips; rather than pull in JSZip for the
 * write path (it's only lazy-loaded for *import*), we emit stored entries: an
 * uncompressed ZIP is a sequence of local file headers + raw data, a central
 * directory, and an end-of-central-directory record. QGIS/GDAL, Google Earth
 * and ATAK all read stored zips fine.
 *
 * Everything is built in the browser and downloaded locally — nothing is
 * uploaded (OPSEC).
 */

// Standard CRC-32 (IEEE 802.3) table + routine — ZIP entries carry a CRC.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a stored (uncompressed) ZIP from a list of entries.
 * @param {Array<{ name:string, data:(Uint8Array|string) }>} entries
 * @returns {Uint8Array} ZIP bytes
 */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const files = entries.map((e) => {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { nameBytes: enc.encode(e.name), data, crc: crc32(data) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const f of files) {
    localSize += 30 + f.nameBytes.length + f.data.length;
    centralSize += 46 + f.nameBytes.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let off = 0;
  const offsets = [];

  // ── Local file headers + data ──────────────────────────────────────────
  for (const f of files) {
    offsets.push(off);
    dv.setUint32(off, 0x04034b50, true); off += 4; // signature
    dv.setUint16(off, 20, true); off += 2; // version needed
    dv.setUint16(off, 0, true); off += 2; // flags
    dv.setUint16(off, 0, true); off += 2; // method = stored
    dv.setUint16(off, 0, true); off += 2; // mod time
    dv.setUint16(off, 0, true); off += 2; // mod date
    dv.setUint32(off, f.crc, true); off += 4;
    dv.setUint32(off, f.data.length, true); off += 4; // compressed size
    dv.setUint32(off, f.data.length, true); off += 4; // uncompressed size
    dv.setUint16(off, f.nameBytes.length, true); off += 2;
    dv.setUint16(off, 0, true); off += 2; // extra length
    out.set(f.nameBytes, off); off += f.nameBytes.length;
    out.set(f.data, off); off += f.data.length;
  }

  // ── Central directory ──────────────────────────────────────────────────
  const centralStart = off;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    dv.setUint32(off, 0x02014b50, true); off += 4; // signature
    dv.setUint16(off, 20, true); off += 2; // version made by
    dv.setUint16(off, 20, true); off += 2; // version needed
    dv.setUint16(off, 0, true); off += 2; // flags
    dv.setUint16(off, 0, true); off += 2; // method
    dv.setUint16(off, 0, true); off += 2; // mod time
    dv.setUint16(off, 0, true); off += 2; // mod date
    dv.setUint32(off, f.crc, true); off += 4;
    dv.setUint32(off, f.data.length, true); off += 4; // compressed
    dv.setUint32(off, f.data.length, true); off += 4; // uncompressed
    dv.setUint16(off, f.nameBytes.length, true); off += 2;
    dv.setUint16(off, 0, true); off += 2; // extra length
    dv.setUint16(off, 0, true); off += 2; // comment length
    dv.setUint16(off, 0, true); off += 2; // disk number start
    dv.setUint16(off, 0, true); off += 2; // internal attrs
    dv.setUint32(off, 0, true); off += 4; // external attrs
    dv.setUint32(off, offsets[i], true); off += 4; // local header offset
    out.set(f.nameBytes, off); off += f.nameBytes.length;
  }

  // ── End of central directory ───────────────────────────────────────────
  dv.setUint32(off, 0x06054b50, true); off += 4; // signature
  dv.setUint16(off, 0, true); off += 2; // disk number
  dv.setUint16(off, 0, true); off += 2; // disk with central dir
  dv.setUint16(off, files.length, true); off += 2; // entries on this disk
  dv.setUint16(off, files.length, true); off += 2; // total entries
  dv.setUint32(off, centralSize, true); off += 4; // central dir size
  dv.setUint32(off, centralStart, true); off += 4; // central dir offset
  dv.setUint16(off, 0, true); off += 2; // comment length

  return out;
}

/** Decode a `data:*;base64,…` URL (e.g. canvas.toDataURL) to raw bytes. */
export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** RFC-4122 v4 UUID — uses crypto.randomUUID when available, else a fallback. */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}
