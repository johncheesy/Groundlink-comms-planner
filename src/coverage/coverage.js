import L from 'leaflet';
import { COVERAGE_CLASS } from './model.js';

/**
 * Coverage controller (main thread).
 *
 * Owns the compute Web Worker, turns its class grid into a coloured canvas
 * using the signal-scale tokens, and drops it on the map as an L.imageOverlay
 * aligned to the AOI bbox. Keeps the UI responsive (compute is off-thread) and
 * reports progress.
 */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** "#rrggbb" → [r,g,b]. */
function hexToRgb(hex, fallback = [255, 255, 255]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TARGET_MAX_DIM = 220; // grid cells on the longer axis (resolution vs speed)

export function createCoverageController(map, { onProgress, onStatus } = {}) {
  // signal-scale colours, resolved once from tokens (class index → rgb)
  const palette = [
    hexToRgb(cssVar('--s1', '#34e6c2')), // excellent
    hexToRgb(cssVar('--s2', '#86e6a0')), // good
    hexToRgb(cssVar('--s3', '#ffd479')), // marginal
    hexToRgb(cssVar('--s4', '#ff9f7a')), // poor / transition
    hexToRgb(cssVar('--s5', '#ff6b8a')), // none
  ];
  const siteColor = cssVar('--feat-site', '#34e6c2');

  let worker = null;
  let jobId = 0;
  let overlay = null;
  let txMarker = null;
  let opacity = 0.7;
  let lastResult = null; // { classes, cols, rows, bounds } for re-paint

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id !== jobId) return; // ignore stale jobs
      if (msg.type === 'progress') {
        onProgress?.(msg.done / msg.total);
      } else if (msg.type === 'done') {
        paint(msg);
        onProgress?.(1);
        onStatus?.('done');
      }
    };
    worker.onerror = () => onStatus?.('error');
    return worker;
  }

  /** Pick grid dimensions so cells are ~square in projected space. */
  function gridDims(bounds) {
    const midLat = (bounds.north + bounds.south) / 2;
    const w = Math.abs(bounds.east - bounds.west) * Math.cos((midLat * Math.PI) / 180);
    const h = Math.abs(bounds.north - bounds.south);
    let cols, rows;
    if (w >= h) {
      cols = TARGET_MAX_DIM;
      rows = Math.max(8, Math.round((TARGET_MAX_DIM * h) / w));
    } else {
      rows = TARGET_MAX_DIM;
      cols = Math.max(8, Math.round((TARGET_MAX_DIM * w) / h));
    }
    return { cols, rows };
  }

  function paint({ classes, cols, rows, bounds = lastResult?.bounds }) {
    if (!bounds) return;
    lastResult = { classes, cols, rows, bounds };

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const data = img.data;

    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const o = i * 4;
      if (cls === COVERAGE_CLASS.TRANSPARENT || cls > 4) {
        data[o + 3] = 0; // no coverage → transparent
        continue;
      }
      const [r, g, b] = palette[cls];
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255; // opaque pixel; layer opacity controls blend
    }
    ctx.putImageData(img, 0, 0);
    // keep edges crisp-ish but allow the browser to smooth between cells
    const url = canvas.toDataURL('image/png');
    const llBounds = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);

    if (overlay) {
      overlay.setUrl(url);
      overlay.setBounds(llBounds);
      overlay.setOpacity(opacity);
    } else {
      overlay = L.imageOverlay(url, llBounds, {
        opacity,
        interactive: false,
        className: 'coverage-overlay',
      }).addTo(map);
      overlay.bringToFront();
    }
  }

  function placeTx(tx) {
    if (txMarker) {
      txMarker.setLatLng(tx);
      return;
    }
    txMarker = L.marker(tx, {
      icon: L.divIcon({ className: 'tx-marker', iconSize: [16, 16] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
  }

  /**
   * Run a coverage compute.
   * @param bounds {west,south,east,north}
   * @param tx {lat,lng}
   * @param params {eirpDbm, freqMHz, rxGainDbi?, clutterDb?, thresholds?, floorDbm?}
   */
  function compute(bounds, tx, params) {
    const w = ensureWorker();
    const { cols, rows } = gridDims(bounds);
    jobId += 1;
    lastResult = { classes: null, cols, rows, bounds };
    placeTx(tx);
    onStatus?.('computing');
    onProgress?.(0);
    w.postMessage({ type: 'compute', id: jobId, bounds, cols, rows, tx, params });
    return jobId;
  }

  function setOpacity(v) {
    opacity = Math.max(0, Math.min(1, v));
    overlay?.setOpacity(opacity);
  }

  function clear() {
    jobId += 1; // invalidate any in-flight job
    if (overlay) {
      map.removeLayer(overlay);
      overlay = null;
    }
    if (txMarker) {
      map.removeLayer(txMarker);
      txMarker = null;
    }
    lastResult = null;
    onStatus?.('cleared');
  }

  return {
    compute,
    setOpacity,
    getOpacity: () => opacity,
    hasCoverage: () => !!overlay,
    clear,
    destroy() {
      clear();
      worker?.terminate();
      worker = null;
    },
  };
}
