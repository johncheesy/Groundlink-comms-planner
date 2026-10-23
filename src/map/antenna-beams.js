/**
 * Antenna beam wedges on the map (M49) — one translucent sector per fixed
 * site, pointing where that site's antenna points, as wide as the antenna's
 * beamwidth. Only for directional antennas; omni sites draw nothing.
 *
 * Drawn as a map-aligned symbol (rotated icon), so the wedge keeps a constant
 * on-screen size at every zoom and turns with the map. Colour is the site
 * feature token (--feat-site): the wedge belongs to the mast.
 */

import { isOmni } from '../coverage/antenna.js';

const SRC = 'gl-antenna-beams';
const LAYER = 'gl-antenna-beams';
const SIZE = 112; // CSS px; drawn at 2x for sharp edges

/**
 * GeoJSON points for the beams: one per site, with its pointing (own or the
 * panel's) and the antenna beamwidth. Empty for an omni antenna. Pure.
 */
export function beamFeatures(sites, antenna) {
  if (!antenna || isOmni(antenna)) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: sites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        az: s.azimuthDeg ?? antenna.azimuthDeg ?? 0,
        bw: Math.round(Math.min(359, Math.max(5, antenna.beamwidthDeg))),
        own: s.azimuthDeg != null,
      },
    })),
  };
}

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Wedge pointing up (north), apex at the image centre. */
function wedgeImage(bwDeg, color) {
  const px = SIZE * 2;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d');
  const cx = px / 2;
  const r = px / 2 - 4;
  const half = (bwDeg / 2) * (Math.PI / 180);
  const up = -Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cx);
  ctx.arc(cx, cx, r, up - half, up + half);
  ctx.closePath();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  // Boresight line, a little longer than the wedge edge.
  ctx.beginPath();
  ctx.moveTo(cx, cx);
  ctx.lineTo(cx, cx - r);
  ctx.lineWidth = 4;
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}

/** Add/refresh the beam layer for `sites` with the current `antenna`. */
export function updateAntennaBeams(map, sites, antenna) {
  if (!map?.isStyleLoaded?.() && !map?.getSource?.(SRC)) {
    map?.once?.('style.load', () => updateAntennaBeams(map, sites, antenna));
    return;
  }
  const data = beamFeatures(sites, antenna);
  const color = cssColor('--feat-site', '#34e6c2');
  for (const f of data.features) {
    const id = `gl-beam-${f.properties.bw}`;
    if (!map.hasImage(id)) map.addImage(id, wedgeImage(f.properties.bw, color), { pixelRatio: 2 });
  }
  const src = map.getSource(SRC);
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(SRC, { type: 'geojson', data });
  map.addLayer({
    id: LAYER,
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': ['concat', 'gl-beam-', ['to-string', ['get', 'bw']]],
      'icon-rotate': ['get', 'az'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
}
