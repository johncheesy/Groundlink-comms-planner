import maplibregl from 'maplibre-gl';

/**
 * M3 — Site-recommendation controller (main thread).
 *
 * Owns the recommend Web Worker, the draggable numbered site markers, and the
 * combined (multi-tx) coverage raster. After the greedy pick — and after each
 * drag (debounced) — it asks the coverage controller to repaint the combined
 * coverage with the current site positions. Dragging never re-runs greedy: the
 * user's placement wins.
 *
 * The site-list DOM and its hover/fly-to wiring live in the caller (main.js),
 * which drives them via getSites(), flyTo(i) and setHighlight(i).
 */
export function createRecommendController(map, coverage, { onProgress, onDone, onStatus } = {}) {
  let worker = null;
  let jobId = 0;
  let markers = []; // maplibregl.Marker[]
  let sites = []; // [{ lat, lng, elevM, label, newlyCovered, cumulativeFrac }]
  let lastArea = null;
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
  function recommend(area, params, opts = {}) {
    if (!area) return;
    clearMarkers();
    sites = [];
    lastArea = area;
    lastParams = { ...params, maxSites: opts.maxSites ?? 3, targetFrac: opts.targetFrac ?? 0.95 };
    const aoi = { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring };
    const w = ensureWorker();
    jobId += 1;
    onProgress?.(0, 'data');
    onStatus?.('Recommending sites…');
    w.postMessage({ type: 'recommend', id: jobId, bounds: area.bounds, aoi, params: lastParams });
  }

  function handleDone(msg) {
    sites = msg.sites || [];
    if (!sites.length) {
      onDone?.([], { terrain: msg.terrain, clutter: msg.clutter, empty: true });
      return;
    }
    placeMarkers();
    computeCombined();
    onDone?.(sites, { terrain: msg.terrain, clutter: msg.clutter });
  }

  // ── Markers ───────────────────────────────────────────────────────────
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

  // ── Combined (multi-tx) coverage ──────────────────────────────────────
  function combinedBounds() {
    let { west, south, east, north } = lastArea.bounds;
    for (const s of sites) {
      west = Math.min(west, s.lng);
      east = Math.max(east, s.lng);
      south = Math.min(south, s.lat);
      north = Math.max(north, s.lat);
    }
    const padLng = (east - west) * 0.12 || 0.01;
    const padLat = (north - south) * 0.12 || 0.01;
    return { west: west - padLng, east: east + padLng, south: south - padLat, north: north + padLat };
  }

  function computeCombined() {
    if (!sites.length || !lastArea || !lastParams) return;
    const txs = sites.map((s) => ({ lat: s.lat, lng: s.lng, txHeightM: lastParams.txHeightM ?? 10 }));
    const aoi = { type: lastArea.type, center: lastArea.center, radiusM: lastArea.radiusM, ring: lastArea.ring };
    // marker:false — the numbered site markers stand in for the tx marker.
    coverage.compute(combinedBounds(), { lat: sites[0].lat, lng: sites[0].lng }, lastParams, {
      marker: false,
      txs,
      aoi,
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
