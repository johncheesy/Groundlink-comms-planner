/**
 * Drop imported geometry the map cannot place, before it reaches MapLibre.
 *
 * A single feature with latitude 95, a non-numeric coordinate, a null geometry
 * or a two-point polygon used to throw inside the map and leave the importer on
 * "Importing…" with an unhandled rejection. Pure and DOM-free.
 *
 * Rules: points with a bad position are dropped; lines lose bad vertices and
 * are dropped below two; polygons are dropped whole if any ring vertex is bad
 * or a ring has under four positions (reshaping a polygon silently would give
 * the wrong area).
 */
import { isLatLng } from '../geo/validate.js';

const okPos = (c) => Array.isArray(c) && c.length >= 2 && isLatLng(c[1], c[0]) && typeof c[0] === 'number' && typeof c[1] === 'number';

function cleanLine(coords) {
  if (!Array.isArray(coords)) return null;
  const kept = coords.filter(okPos);
  return kept.length >= 2 ? kept : null;
}

function cleanRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every(okPos) ? ring : null;
}

function cleanPolygon(rings) {
  if (!Array.isArray(rings) || !rings.length) return null;
  const out = rings.map(cleanRing);
  return out.every(Boolean) ? out : null;
}

/** @returns {object|null} a usable geometry, or null */
export function cleanGeometry(g) {
  if (!g || typeof g !== 'object') return null;
  switch (g.type) {
    case 'Point': return okPos(g.coordinates) ? g : null;
    case 'MultiPoint': {
      const pts = (Array.isArray(g.coordinates) ? g.coordinates : []).filter(okPos);
      return pts.length ? { ...g, coordinates: pts } : null;
    }
    case 'LineString': {
      const c = cleanLine(g.coordinates);
      return c ? { ...g, coordinates: c } : null;
    }
    case 'MultiLineString': {
      const lines = (Array.isArray(g.coordinates) ? g.coordinates : []).map(cleanLine).filter(Boolean);
      return lines.length ? { ...g, coordinates: lines } : null;
    }
    case 'Polygon': {
      const p = cleanPolygon(g.coordinates);
      return p ? { ...g, coordinates: p } : null;
    }
    case 'MultiPolygon': {
      const polys = (Array.isArray(g.coordinates) ? g.coordinates : []).map(cleanPolygon).filter(Boolean);
      return polys.length ? { ...g, coordinates: polys } : null;
    }
    default: return null;
  }
}

/** @returns {{ features: object[], dropped: number }} */
export function cleanFeatures(features) {
  const kept = [];
  let dropped = 0;
  for (const f of Array.isArray(features) ? features : []) {
    const geometry = cleanGeometry(f?.geometry);
    if (!geometry) { dropped += 1; continue; }
    kept.push({ ...f, geometry });
  }
  return { features: kept, dropped };
}
