import maplibregl from 'maplibre-gl';
import { COVERAGE_CLASS } from './model.js';
import {
  buildServerImage, serverLegend, SERVER_PALETTE_FALLBACK, CONTEST_FALLBACK,
  DEFAULT_INTERFERENCE_DB,
} from './bestserver.js';

/**
 * Coverage controller (main thread) for MapLibre GL.
 *
 * Owns the compute Web Worker, turns its class grid into a coloured canvas
 * using the signal-scale tokens, and shows it as a MapLibre `image` source +
 * raster layer aligned to the AOI bbox. Compute is off-thread → UI stays
 * responsive; progress is reported.
 */

const SRC = 'coverage';
const LAYER = 'coverage-layer';
const BEFORE = 'aoi-fill'; // keep the AOI outline on top of the raster

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function hexToRgb(hex, fallback = [255, 255, 255]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TARGET_MAX_DIM = 220;

export function createCoverageController(
  map,
  { onProgress, onStatus, onPaint, src = SRC, layer = LAYER, before = BEFORE, opacity: initialOpacity = 0.7, tint = null } = {},
) {
  // When `tint` is set (a hex colour), every covered cell paints that one colour
  // — used by the cellular layers (one flat colour per network type). Otherwise
  // the signal-scale palette colours cells by quality.
  const tintRgb = tint ? hexToRgb(tint) : null;
  const palette = [
    hexToRgb(cssVar('--s1', '#34e6c2')),
    hexToRgb(cssVar('--s2', '#86e6a0')),
    hexToRgb(cssVar('--s3', '#ffd479')),
    hexToRgb(cssVar('--s4', '#ff9f7a')),
    hexToRgb(cssVar('--s5', '#ff6b8a')),
  ];
  // M24 categorical site palette + contested colour from the --srv-* tokens.
  const serverPalette = SERVER_PALETTE_FALLBACK.map((fb, i) =>
    hexToRgb(cssVar(`--srv-${i + 1}`, ''), fb),
  );
  const contestRgb = hexToRgb(cssVar('--srv-contest', ''), CONTEST_FALLBACK);

  let worker = null;
  let jobId = 0;
  let opacity = initialOpacity;
  let txMarker = null;
  let hasLayer = false;
  let currentBounds = null; // bbox of the in-flight / last job (worker omits it)
  let currentRender = true; // whether the current job paints to the map
  let currentMarker = true; // whether the current job (re)places the tx marker
  let lastStats = null; // { total, covered, byClass:[5], coveredFrac }
  let lastCanvas = null; // last rendered coverage canvas (for M16 raster export)
  let lastPaintBounds = null; // bbox of that canvas (for georeferencing exports)
  let pendingResolve = null; // for computeAsync()
  // M24 best-server view state.
  let lastRaw = null; // { classes, servers, marginQ, cols, rows, bounds }
  let view = 'quality'; // 'quality' | 'server'
  let interference = false;
  let interferenceDb = DEFAULT_INTERFERENCE_DB;
  let lastServer = null; // { counts, covered, contested } from the last server render
  let currentTxNames = null; // site names captured at compute time (legend)

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../workers/coverage.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id !== jobId) return;
      if (msg.type === 'progress') onProgress?.(msg.done / msg.total, msg.phase);
      else if (msg.type === 'done') {
        paint(msg);
        onProgress?.(1, 'compute');
        onStatus?.('done', {
          terrain: msg.terrain,
          clutter: msg.clutter,
          engine: msg.engine,
          elevSource: msg.elevSource ?? null,
          clutterSource: msg.clutterSource ?? null,
        });
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r(lastStats);
        }
      }
    };
    worker.onerror = () => {
      onStatus?.('error');
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r(null);
      }
    };
    return worker;
  }

  function gridDims(bounds) {
    const midLat = (bounds.north + bounds.south) / 2;
    const w = Math.abs(bounds.east - bounds.west) * Math.cos((midLat * Math.PI) / 180);
    const h = Math.abs(bounds.north - bounds.south);
    if (w >= h) return { cols: TARGET_MAX_DIM, rows: Math.max(8, Math.round((TARGET_MAX_DIM * h) / w)) };
    return { rows: TARGET_MAX_DIM, cols: Math.max(8, Math.round((TARGET_MAX_DIM * w) / h)) };
  }

  function paint(msg) {
    const { classes, cols, rows, terrain, clutter, inAoi, coveredInAoi, coveredFracAoi } = msg;
    const bounds = currentBounds;
    if (!bounds) return;
    // Keep the raw worker arrays so the M24 view toggle re-renders without a
    // recompute (classes for quality, servers/marginQ for best-server).
    lastRaw = { classes, servers: msg.servers ?? null, marginQ: msg.marginQ ?? null, cols, rows, bounds };
    if (!lastRaw.servers && view === 'server') view = 'quality'; // single-tx run
    const byClass = [0, 0, 0, 0, 0];
    let covered = 0;
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (cls === COVERAGE_CLASS.TRANSPARENT || cls > 4) continue;
      byClass[cls] += 1;
      if (cls <= 2) covered += 1; // excellent/good/marginal = usable
    }
    const total = classes.length;
    lastStats = {
      total,
      covered,
      byClass,
      coveredFrac: total ? covered / total : 0,
      // In-AOI fraction (null when no AOI mask was passed — e.g. drone relay):
      // counts only cells inside the drawn shape, not the bbox corners.
      inAoi: inAoi ?? null,
      coveredInAoi: coveredInAoi ?? null,
      coveredFracAoi: coveredFracAoi ?? null,
      terrain: !!terrain,
      clutter: !!clutter,
    };
    if (!currentRender) return; // stats-only pass (e.g. gain-vs-ground baseline)
    renderRaster();
    // Let callers paint a derived overlay (e.g. the M15 digital-cliff band) from
    // the same class grid and bbox we just rendered.
    onPaint?.(classes, cols, rows, bounds);
  }

  /** Paint lastRaw to the image source according to the active view (M24). */
  function renderRaster() {
    if (!lastRaw) return;
    const { classes, servers, marginQ, cols, rows, bounds } = lastRaw;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    let img;
    if (view === 'server' && servers) {
      const res = buildServerImage(servers, marginQ, {
        palette: serverPalette,
        interference,
        thresholdDb: interferenceDb,
        contestColor: contestRgb,
      });
      lastServer = res;
      img = new ImageData(res.data, cols, rows);
    } else {
      lastServer = null;
      const data = new Uint8ClampedArray(cols * rows * 4);
      for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        const o = i * 4;
        if (cls === COVERAGE_CLASS.TRANSPARENT || cls > 4) continue;
        const [r, g, b] = tintRgb || palette[cls];
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
      img = new ImageData(data, cols, rows);
    }
    ctx.putImageData(img, 0, 0);
    lastCanvas = canvas; // keep a reference for raster export (GeoTIFF/KMZ/TAK)
    lastPaintBounds = bounds;
    const url = canvas.toDataURL('image/png');
    // image-source coordinates: TL, TR, BR, BL
    const coordinates = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];

    if (hasLayer && map.getSource(src)) {
      map.getSource(src).updateImage({ url, coordinates });
    } else {
      map.addSource(src, { type: 'image', url, coordinates });
      // Sit before the configured layer; fall back to the AOI outline so the
      // raster always stays beneath it (and above the basemap).
      const beforeId = map.getLayer(before) ? before : (map.getLayer(BEFORE) ? BEFORE : undefined);
      map.addLayer(
        {
          id: layer,
          type: 'raster',
          source: src,
          paint: { 'raster-opacity': opacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
        },
        beforeId,
      );
      hasLayer = true;
    }
  }

  function placeTx(tx) {
    const lngLat = [tx.lng, tx.lat];
    if (txMarker) {
      txMarker.setLngLat(lngLat);
      return;
    }
    const el = document.createElement('div');
    el.className = 'tx-marker';
    txMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }

  function compute(bounds, tx, params, opts = {}) {
    const w = ensureWorker();
    const { cols, rows } = gridDims(bounds);
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r(null);
    }
    jobId += 1;
    currentBounds = bounds;
    currentRender = opts.render !== false;
    currentMarker = opts.marker !== false;
    if (currentMarker) placeTx(tx);
    onStatus?.('computing');
    onProgress?.(0);
    // opts.aoi (optional) lets the worker report coverage against the drawn
    // shape rather than the bbox; absent for drone-relay calls.
    // opts.txs (optional) is the M3 multi-site list; when present the worker
    // paints the combined (max-dBm) coverage across all sites.
    // opts.files (optional, E1) carries user-loaded local COGs (File objects
    // structured-clone into the worker; read in-browser, never uploaded).
    // M24: with ≥2 sites, always collect best-server data (2 bytes/cell) so
    // the view toggle works without a recompute; names feed the zone legend.
    const multi = (opts.txs?.length ?? 0) >= 2;
    currentTxNames = multi ? (opts.txNames ?? null) : null;
    const p = multi ? { ...params, collectServer: true } : params;
    w.postMessage({ type: 'compute', id: jobId, bounds, cols, rows, tx, params: p, aoi: opts.aoi ?? null, txs: opts.txs ?? null, clipToAoi: opts.clipToAoi ?? false, files: opts.files ?? null });
    return jobId;
  }

  /** Promise variant — resolves with the result stats after the job completes. */
  function computeAsync(bounds, tx, params, opts = {}) {
    return new Promise((resolve) => {
      // compute() resolves any prior orphaned pending promise with null and
      // clears it before bumping jobId, so install ours afterwards.
      compute(bounds, tx, params, opts);
      pendingResolve = resolve;
    });
  }

  function setOpacity(v) {
    opacity = Math.max(0, Math.min(1, v));
    if (hasLayer && map.getLayer(layer)) map.setPaintProperty(layer, 'raster-opacity', opacity);
  }

  function setVisible(on) {
    if (hasLayer && map.getLayer(layer)) {
      map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
    }
  }

  function clear() {
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r(null);
    }
    jobId += 1;
    // Tell the worker to abort an in-flight sweep so it stops burning CPU
    // (results are already gated by jobId; this frees the thread immediately).
    worker?.postMessage({ type: 'cancel' });
    if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(src)) map.removeSource(src);
    hasLayer = false;
    lastCanvas = null;
    lastPaintBounds = null;
    lastRaw = null;
    lastServer = null;
    view = 'quality';
    txMarker?.remove();
    txMarker = null;
    onStatus?.('cleared');
  }

  return {
    compute,
    computeAsync,
    setOpacity,
    setVisible,
    getOpacity: () => opacity,
    getStats: () => lastStats,
    getLastCanvas: () => lastCanvas,
    getLastBounds: () => lastPaintBounds,
    hasCoverage: () => hasLayer,
    // ── M24 best-server view ────────────────────────────────────────────
    hasServerData: () => !!lastRaw?.servers,
    getView: () => view,
    /** Switch quality ↔ best-server; re-renders from cached data, no recompute. */
    setView(v) {
      view = v === 'server' && lastRaw?.servers ? 'server' : 'quality';
      if (lastRaw) renderRaster();
      return view;
    },
    /** Toggle the contested-overlap band (and optionally its dB threshold). */
    setInterference(on, thresholdDb) {
      interference = !!on;
      if (Number.isFinite(thresholdDb)) interferenceDb = thresholdDb;
      if (lastRaw && view === 'server') renderRaster();
    },
    /** Zone legend + stats for the last server render (null in quality view). */
    getServerInfo() {
      if (!lastServer) return null;
      return {
        covered: lastServer.covered,
        contested: lastServer.contested,
        contestedFrac: lastServer.covered ? lastServer.contested / lastServer.covered : 0,
        interference,
        thresholdDb: interferenceDb,
        legend: serverLegend(lastServer.counts, lastServer.covered, currentTxNames ?? []),
        colors: serverPalette.map((rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`),
      };
    },
    clear,
    destroy() {
      clear();
      worker?.terminate();
      worker = null;
    },
  };
}
