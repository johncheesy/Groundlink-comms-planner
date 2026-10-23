/**
 * Per-cell alpha that keeps the painted raster to the area of interest.
 *
 * The compute window is a rectangle up to about three times the AOI, and
 * painting all of it read as a square "propagation" shape (user report,
 * 23 Oct 2026). On screen the raster now shows at full strength inside the
 * AOI and fades linearly to nothing over a margin outside it: a radius AOI
 * becomes a soft disc, a polygon a soft polygon. Exports (GeoTIFF, KMZ,
 * TAK) keep the full grid — the fade is presentation, not data.
 *
 * Pure, DOM-free; exported for tests.
 */

import { haversineM } from './model.js';
import { pointInRing } from '../geo/aoi-mask.js';

/** Fade margin: a quarter of the AOI's size, at least 400 m, at most 5 km. */
export function fadeMarginM(aoi) {
  if (!aoi) return 0;
  let sizeM;
  if (aoi.type === 'radius') sizeM = aoi.radiusM;
  else {
    const ring = aoi.ring ?? [];
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng; if (lng > east) east = lng;
      if (lat < south) south = lat; if (lat > north) north = lat;
    }
    sizeM = ring.length ? haversineM(south, west, north, east) / 2 : 0;
  }
  return Math.min(5000, Math.max(400, sizeM * 0.25));
}

/**
 * Distance (m) from a point to the AOI boundary, 0 inside. Polygon distance
 * is computed in a local metre frame (cos-lat scaled), fine at AOI scale.
 */
export function distanceOutsideM(aoi, lng, lat) {
  if (aoi.type === 'radius') {
    return Math.max(0, haversineM(aoi.center.lat, aoi.center.lng, lat, lng) - aoi.radiusM);
  }
  const ring = aoi.ring ?? [];
  if (ring.length < 3) return 0;
  if (pointInRing(ring, lng, lat)) return 0;
  const k = Math.cos((lat * Math.PI) / 180) * 111320;
  const px = lng * k;
  const py = lat * 111320;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * k, ay = ring[j][1] * 111320;
    const bx = ring[i][0] * k, by = ring[i][1] * 111320;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Alpha per grid cell (0–1, Float32Array of cols*rows), or null when there is
 * no AOI. Cell centres are sampled; the linear ramp over `marginM` gives a
 * soft edge at any grid resolution.
 */
export function aoiAlpha(bounds, cols, rows, aoi, marginM = fadeMarginM(aoi)) {
  if (!aoi || !(aoi.type === 'radius' ? aoi.center && aoi.radiusM > 0 : aoi.ring?.length >= 3)) return null;
  const { west, south, east, north } = bounds;
  const cellW = (east - west) / cols;
  const cellH = (north - south) / rows;
  const out = new Float32Array(cols * rows);
  const m = Math.max(1, marginM);
  for (let r = 0; r < rows; r++) {
    const lat = north - (r + 0.5) * cellH;
    for (let c = 0; c < cols; c++) {
      const lng = west + (c + 0.5) * cellW;
      const d = distanceOutsideM(aoi, lng, lat);
      out[r * cols + c] = d <= 0 ? 1 : d >= m ? 0 : 1 - d / m;
    }
  }
  return out;
}

/** Multiply an RGBA buffer's alpha by the mask, in place. */
export function applyAlpha(data, alpha) {
  if (!alpha) return;
  for (let i = 0, o = 3; i < alpha.length; i++, o += 4) {
    const a = alpha[i];
    if (a < 1) data[o] = Math.round(data[o] * a);
  }
}
