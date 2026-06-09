/**
 * Minimal client-side GeoTIFF writer — no third-party library.
 *
 * Encodes the coverage canvas as a single-strip, uncompressed RGBA TIFF with
 * just enough GeoTIFF tags (ModelPixelScale + ModelTiepoint + a WGS84
 * GeoKeyDirectory) for QGIS / GDAL to place it on EPSG:4326. The pixel data is
 * the raster the map already shows, so the export matches the on-screen overlay.
 *
 * A `.tfw`/`.pgw` world file is also offered (worldFile) as the universally
 * portable fallback for any GIS that doesn't read the embedded GeoKeys.
 *
 * Everything is built and downloaded in the browser — nothing is uploaded.
 */

// TIFF field types we use.
const T_SHORT = 3;
const T_LONG = 4;
const T_RATIONAL = 5;
const T_DOUBLE = 12;

function toImageData(source) {
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) return source;
  const ctx = source.getContext('2d');
  return ctx.getImageData(0, 0, source.width, source.height);
}

function shortsBytes(arr) {
  const u = new Uint8Array(arr.length * 2);
  const dv = new DataView(u.buffer);
  arr.forEach((v, i) => dv.setUint16(i * 2, v, true));
  return u;
}
function rationalsBytes(pairs) {
  const u = new Uint8Array(pairs.length * 8);
  const dv = new DataView(u.buffer);
  pairs.forEach(([n, d], i) => {
    dv.setUint32(i * 8, n, true);
    dv.setUint32(i * 8 + 4, d, true);
  });
  return u;
}
function doublesBytes(arr) {
  const u = new Uint8Array(arr.length * 8);
  const dv = new DataView(u.buffer);
  arr.forEach((v, i) => dv.setFloat64(i * 8, v, true));
  return u;
}

/**
 * Encode a coverage canvas/ImageData as a georeferenced RGBA GeoTIFF.
 * @param {HTMLCanvasElement|ImageData} source  coverage raster
 * @param {{ west:number, south:number, east:number, north:number }} bounds
 * @returns {Uint8Array} GeoTIFF bytes (little-endian)
 */
export function encodeCoverageGeoTIFF(source, bounds) {
  const img = toImageData(source);
  const width = img.width;
  const height = img.height;
  const pixels = img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data.buffer.slice(0));

  const scaleX = (bounds.east - bounds.west) / width;
  const scaleY = (bounds.north - bounds.south) / height;

  // GeoKeyDirectory: header (4 shorts) + N keys (4 shorts each).
  // ModelTypeGeographic, RasterPixelIsArea, GCS = WGS84 (4326), angular = degree.
  const geoKeys = [
    1, 1, 0, 4, // version, key rev, minor rev, number of keys
    1024, 0, 1, 2, // GTModelTypeGeoKey = ModelTypeGeographic
    1025, 0, 1, 1, // GTRasterTypeGeoKey = RasterPixelIsArea
    2048, 0, 1, 4326, // GeographicTypeGeoKey = WGS84
    2054, 0, 1, 9102, // GeogAngularUnitsGeoKey = degree
  ];

  // Tags must be written in ascending order. Each entry declares whether its
  // value is inline (≤4 bytes, stored in the value field) or an offset to a
  // block appended after the IFD.
  const entries = [
    { tag: 256, type: T_LONG, count: 1, value: width }, // ImageWidth
    { tag: 257, type: T_LONG, count: 1, value: height }, // ImageLength
    { tag: 258, type: T_SHORT, count: 4, bytes: shortsBytes([8, 8, 8, 8]) }, // BitsPerSample
    { tag: 259, type: T_SHORT, count: 1, value: 1 }, // Compression = none
    { tag: 262, type: T_SHORT, count: 1, value: 2 }, // Photometric = RGB
    { tag: 273, type: T_LONG, count: 1, value: 0, isStripOffset: true }, // StripOffsets (patched)
    { tag: 277, type: T_SHORT, count: 1, value: 4 }, // SamplesPerPixel
    { tag: 278, type: T_LONG, count: 1, value: height }, // RowsPerStrip
    { tag: 279, type: T_LONG, count: 1, value: width * height * 4 }, // StripByteCounts
    { tag: 282, type: T_RATIONAL, count: 1, bytes: rationalsBytes([[72, 1]]) }, // XResolution
    { tag: 283, type: T_RATIONAL, count: 1, bytes: rationalsBytes([[72, 1]]) }, // YResolution
    { tag: 296, type: T_SHORT, count: 1, value: 2 }, // ResolutionUnit = inch
    { tag: 338, type: T_SHORT, count: 1, value: 2 }, // ExtraSamples = unassociated alpha
    { tag: 33550, type: T_DOUBLE, count: 3, bytes: doublesBytes([scaleX, scaleY, 0]) }, // ModelPixelScale
    { tag: 33922, type: T_DOUBLE, count: 6, bytes: doublesBytes([0, 0, 0, bounds.west, bounds.north, 0]) }, // ModelTiepoint
    { tag: 34735, type: T_SHORT, count: geoKeys.length, bytes: shortsBytes(geoKeys) }, // GeoKeyDirectory
  ];

  const ifdSize = 2 + entries.length * 12 + 4;
  const extraStart = 8 + ifdSize;

  // Lay out the appended value blocks (even-padded), recording each offset.
  let cursor = extraStart;
  for (const e of entries) {
    if (e.bytes) {
      e.offset = cursor;
      cursor += e.bytes.length + (e.bytes.length & 1); // pad to even
    }
  }
  const pixelOffset = cursor;
  const total = pixelOffset + pixels.length;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);

  // ── TIFF header (little-endian) ────────────────────────────────────────
  out[0] = 0x49; out[1] = 0x49; // "II"
  dv.setUint16(2, 42, true); // magic
  dv.setUint32(4, 8, true); // first IFD offset

  // ── IFD ────────────────────────────────────────────────────────────────
  let off = 8;
  dv.setUint16(off, entries.length, true); off += 2;
  for (const e of entries) {
    if (e.isStripOffset) e.value = pixelOffset;
    dv.setUint16(off, e.tag, true); off += 2;
    dv.setUint16(off, e.type, true); off += 2;
    dv.setUint32(off, e.count, true); off += 4;
    // Inline value or offset, both written as a 32-bit LE field (a single SHORT
    // lands left-justified in the low two bytes, which is correct for LE).
    dv.setUint32(off, e.bytes ? e.offset : e.value, true); off += 4;
  }
  dv.setUint32(off, 0, true); off += 4; // next IFD = none

  // ── Appended value blocks ──────────────────────────────────────────────
  for (const e of entries) {
    if (e.bytes) out.set(e.bytes, e.offset);
  }

  // ── Pixel data (RGBA, top row first) ───────────────────────────────────
  out.set(pixels, pixelOffset);

  return out;
}

/**
 * ESRI world-file text for the raster (`.tfw` for TIFF, `.pgw` for PNG).
 * Six lines: x pixel size, rotation, rotation, y pixel size (negative),
 * x of upper-left pixel centre, y of upper-left pixel centre.
 */
export function worldFile(bounds, width, height) {
  const scaleX = (bounds.east - bounds.west) / width;
  const scaleY = (bounds.north - bounds.south) / height;
  return [
    scaleX,
    0,
    0,
    -scaleY,
    bounds.west + scaleX / 2,
    bounds.north - scaleY / 2,
  ].join('\n') + '\n';
}
