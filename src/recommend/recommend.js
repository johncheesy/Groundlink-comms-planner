import maplibregl from 'maplibre-gl';

/**
 * M3 + M4 — Site-recommendation controller (main thread).
 *
 * Owns the recommend Web Worker, the draggable numbered site markers, and the
 * combined (multi-tx) coverage raster. The worker is fed the mission's demand
 * set (AOI grid + route + points) and any fixed sites as locked, pre-placed
 * transmitters — greedy only adds masts where the fixed sites fall short.
 *
 * After the greedy pick — and after each drag (debounced) — it asks the
 * coverage controller to repaint the combined coverage with the locked sites
 * plus the current recommended positions. Dragging never re-runs greedy: the
 * user's placement wins.
 *
 * recommend(input, params, opts):
 *   input = { bounds, aoi:mask|null, demand:[{lat,lng}], lockedSites:[{lat,lng,name}] }
 *
 * The site-list DOM and its hover/fly-to wiring live in the caller (main.js),
 * driven via getSites(), flyTo(i) and setHighlight(i).
 */
export function createRecommendController(map, coverage, { onProgress, onDone, onStatus } = {}) {
  let worker = null;
  let jobId = 0;
  let markers = []; // maplibregl.Marker[] — recommended masts only
  let sites = []; // recommended [{ lat, lng, elevM, label, newlyCovered, cumulativeFrac }]
  let input = null; // last { bounds, aoi, demand, lockedSites }
  let lastParams = null;
  let dragTimer = null;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../workers/recommend.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id !== jobId) return;
      if (msg.type === 'progress') onProgress?.(msg.done / msg.total, msg.phase);
      else if (msg.type === 'done') handleDone(msg);
      else if (msg.type === 'error') onStatus?.(`Site recommendation failed: ${msg.message}`);
    };
    worker.onerror = () => onStatus?.('Recommend worker failed — see console.');
    return worker;
  }

  /** Run a fresh recommendation. params should include txHeightM + rxHeightM. */
  function recommend(inp, params, opts = {}) {
    if (!inp || !inp.bounds) return;
    clearMarkers();
    sites = [];
    input = {
      bounds: inp.bounds,
      aoi: inp.aoi ?? null,
      demand: inp.demand ?? null,
      lockedSites: inp.lockedSites ?? [],
    };
    lastParams = { ...params, maxSites: opts.maxSites ?? 3, targetFrac: opts.targetFrac ?? 0.95 };
    const w = ensureWorker();
    jobId += 1;
    onProgress?.(0, 'data');
    onStatus?.('Recommending sites…');
    w.postMessage({
      type: 'recommend', id: jobId,
      bounds: input.bounds, aoi: input.aoi, demand: input.demand, lockedSites: input.lockedSites,
      params: lastParams,
    });
  }

  function handleDone(msg) {
    sites = msg.sites || [];
    const info = {
      terrain: msg.terrain, clutter: msg.clutter,
      baseFrac: msg.baseFrac, lockedCount: msg.lockedCount, demandCount: msg.demandCount,
    };
    // Nothing to show only when there are neither recommended nor fixed sites.
    if (!sites.length && !msg.lockedCount) {
      onDone?.([], { ...info, empty: true });
      return;
    }
    placeMarkers();
    computeCombined();
    onDone?.(sites, info);
  }

  // ── Markers (recommended masts; fixed sites keep their mission markers) ─
  function placeMarkers() {
    clearMarkers();
    sites.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'site-marker';
      el.dataset.n = String(i + 1);
      el.textContent = String(i + 1);
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([s.lng, s.lat]).addTo(map);
      m.on('dragstart', () => el.classList.add('is-dragging'));
      m.on('dragend', () => {
        el.classList.remove('is-dragging');
        const p = m.getLngLat();
        sites[i] = { ...sites[i], lng: p.lng, lat: p.lat };
        scheduleRecompute();
      });
      markers.push(m);
    });
  }

  function clearMarkers() {
    markers.forEach((m) => m.remove());
    markers = [];
  }

  function scheduleRecompute() {
    clearTimeout(dragTimer);
    onStatus?.('Recomputing combined coverage…');
    dragTimer = setTimeout(computeCombined, 300);
  }

  // ── Combined (multi-tx) coverage: locked sites + recommended masts ──────
  function allTxs() {
    const h = lastParams.txHeightM ?? 10;
    const locked = (input.lockedSites || []).map((s) => ({ lat: s.lat, lng: s.lng, txHeightM: h }));
    const recommended = sites.map((s) => ({ lat: s.lat, lng: s.lng, txHeightM: h }));
    return [...locked, ...recommended];
  }

  function combinedBounds() {
    let { west, south, east, north } = input.bounds;
    for (const t of allTxs()) {
      west = Math.min(west, t.lng);
      east = Math.max(east, t.lng);
      south = Math.min(south, t.lat);
      north = Math.max(north, t.lat);
    }
    const padLng = (east - west) * 0.12 || 0.01;
    const padLat = (north - south) * 0.12 || 0.01;
    return { west: west - padLng, east: east + padLng, south: south - padLat, north: north + padLat };
  }

  function computeCombined() {
    const txs = allTxs();
    if (!txs.length || !input || !lastParams) return;
    // marker:false — the numbered / fixed-site markers stand in for the tx marker.
    coverage.compute(combinedBounds(), { lat: txs[0].lat, lng: txs[0].lng }, lastParams, {
      marker: false,
      txs,
      aoi: input.aoi, // may be null for route/points-only missions
    });
  }

  // ── List ↔ marker interaction (driven by the caller's list rows) ───────
  function setHighlight(i) {
    markers.forEach((m, idx) => m.getElement().classList.toggle('is-hot', idx === i));
  }

  function flyTo(i) {
    const s = sites[i];
    if (s) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 11) });
  }

  function clear() {
    jobId += 1;
    clearTimeout(dragTimer);
    clearMarkers();
    sites = [];
    coverage.clear();
    onDone?.(null, { cleared: true });
  }

  return {
    recommend,
    clear,
    getSites: () => sites.map((s) => ({ ...s })),
    setHighlight,
    flyTo,
    hasSites: () => sites.length > 0,
    destroy() {
      clear();
      worker?.terminate();
      worker = null;
    },
  };
}
