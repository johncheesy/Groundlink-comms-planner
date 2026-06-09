import { COVERAGE_CLASS } from './model.js';

/**
 * Digital-cliff overlay (M15).
 *
 * For digital modes (DMR/P25/dPMR) the marginal→poor gap collapses to ~1 dB, so
 * coverage class 3 (POOR) is the thin transition ring right at the "digital
 * cliff" — the band where BER is about to collapse from usable to nothing.
 *
 * This paints a second image layer that colours ONLY class-3 cells in amber, so
 * the planner can see exactly where the cliff edge falls. It sits above the main
 * coverage raster but below the AOI outline. Disabled (removed) for Analogue,
 * which degrades gracefully and has no cliff.
 */

const SRC = 'cliff-band';
const LAYER = 'cliff-band-layer';
const ABOVE = 'aoi-fill'; // keep the AOI outline on top of the overlay
const CLIFF_CLASS = COVERAGE_CLASS.POOR; // class 3 — the narrow pre-cliff band
const CLIFF_ALPHA = 153; // ~60% opacity

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function hexToRgb(hex, fallback = [255, 212, 121]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Add or update the cliff-band overlay.
 * @param {maplibregl.Map} map
 * @param {Uint8Array} classes coverage class grid from the worker
 * @param {number} cols
 * @param {number} rows
 * @param {{west:number, south:number, east:number, north:number}} bounds
 * @param {boolean} enabled hide/remove when false (e.g. Analogue mode)
 */
export function updateCliffLayer(map, classes, cols, rows, bounds, enabled) {
  if (!enabled || !classes || !bounds) {
    clearCliffLayer(map);
    return;
  }

  const [r, g, b] = hexToRgb(cssVar('--feat-event', '#ffd479'));
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  const data = img.data;

  let any = false;
  for (let i = 0; i < classes.length; i++) {
    const o = i * 4;
    if (classes[i] === CLIFF_CLASS) {
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = CLIFF_ALPHA;
      any = true;
    } else {
      data[o + 3] = 0; // transparent everywhere else
    }
  }

  // No cliff cells in this raster — nothing to mark, so drop the layer.
  if (!any) {
    clearCliffLayer(map);
    return;
  }

  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  // image-source coordinates: TL, TR, BR, BL
  const coordinates = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ];

  if (map.getSource(SRC)) {
    map.getSource(SRC).updateImage({ url, coordinates });
    if (map.getLayer(LAYER)) map.setLayoutProperty(LAYER, 'visibility', 'visible');
  } else {
    map.addSource(SRC, { type: 'image', url, coordinates });
    // Sit just below the AOI outline → above the coverage raster.
    const beforeId = map.getLayer(ABOVE) ? ABOVE : undefined;
    map.addLayer(
      {
        id: LAYER,
        type: 'raster',
        source: SRC,
        paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      },
      beforeId,
    );
  }
}

/** Remove the cliff-band overlay (source + layer) if present. */
export function clearCliffLayer(map) {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(SRC)) map.removeSource(SRC);
}
