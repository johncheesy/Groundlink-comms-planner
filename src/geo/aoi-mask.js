/**
 * AOI masking + demand-grid helpers — pure, DOM-free, worker-safe.
 *
 * Extracted so the mission model (main thread) and the recommend worker share
 * exactly one implementation of "is this point in the AOI?" and "lay a masked
 * demand grid over this bbox". Geometry only; no fetches, no coordinates leave.
 */
import { haversineM } from '../coverage/model.js';

/** Is (lng, lat) inside the AOI shape? Radius → distance; polygon → ray-cast. */
export function inAoi(aoi, lng, lat) {
  if (!aoi) return true;
  if (aoi.type === 'radius') {
    return haversineM(aoi.center.lat, aoi.center.lng, lat, lng) <= aoi.radiusM;
  }
  return pointInRing(aoi.ring, lng, lat);
}

/** Ray-casting point-in-polygon against a ring of [lng, lat] pairs. */
export function pointInRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Grid of rx positions inside the AOI. cols/rows scale with the bbox aspect
 * ratio, capped at maxDim, then masked to the AOI shape → typically 400–700
 * in-shape points. Returns [{ lng, lat }, …].
 */
export function demandGrid(bounds, aoi, maxDim = 28) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const w = Math.abs(east - west) * Math.cos((midLat * Math.PI) / 180);
  const h = Math.abs(north - south);
  let cols, rows;
  if (w >= h) {
    cols = maxDim;
    rows = Math.max(4, Math.round((maxDim * h) / w));
  } else {
    rows = maxDim;
    cols = Math.max(4, Math.round((maxDim * w) / h));
  }

  const points = [];
  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * (north - south);
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * (east - west);
      if (inAoi(aoi, lng, lat)) points.push({ lng, lat });
    }
  }
  return points;
}

/** Pad a bbox outward by `frac` of its width/height. */
export function padBounds(b, frac) {
  const dLng = (b.east - b.west) * frac;
  const dLat = (b.north - b.south) * frac;
  return { west: b.west - dLng, east: b.east + dLng, south: b.south - dLat, north: b.north + dLat };
}

/** Diagonal length (m) of a bbox. */
export function diagonalM(b) {
  return haversineM(b.south, b.west, b.north, b.east);
}

/** Bounding box of an array of { lat, lng } (or null when empty). */
export function bboxOfPoints(pts) {
  if (!pts || !pts.length) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const p of pts) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return { west, south, east, north };
}
