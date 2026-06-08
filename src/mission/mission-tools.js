import maplibregl from 'maplibre-gl';

/**
 * Mission map tools (M4) — click-to-place Site / Route / Point editing for
 * MapLibre, driving the pure mission model. One armed mode at a time, mirroring
 * the AOI tool's grammar:
 *
 *   • Site  — click places a teal, draggable site (fixed mast / repeater).
 *   • Route — click adds vertices; Enter / double-click finishes; Backspace
 *             undoes; Esc cancels. Azure line; committed vertices draggable.
 *   • Point — click places an amber, draggable demand point.
 *
 * Esc always disarms. Sites/points/route vertices open a small popup with a ×
 * to delete (same idea as the import popup). Works on touch (tap to place).
 *
 * Rendering: sites + points are DOM markers; the route is a GeoJSON line plus
 * draggable DOM vertex markers. The controller is the only interactive mutator
 * of the model; refresh() rebuilds all markers from model state, so external
 * edits (bulk-add, import promotion, per-type clear) just call refresh().
 */

const SRC_ROUTE = 'mission-route';
const SRC_ROUTE_PREVIEW = 'mission-route-preview';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const lineFeat = (coords) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: {},
});
const fc = (features) => ({ type: 'FeatureCollection', features });

export function createMissionTools(map, mission, { onHint, onModeChange, onStatus, formatCoord } = {}) {
  const track = cssVar('--feat-track', '#46a6ff');

  if (!map.getSource(SRC_ROUTE)) {
    map.addSource(SRC_ROUTE, { type: 'geojson', data: fc([]) });
    map.addSource(SRC_ROUTE_PREVIEW, { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: SRC_ROUTE,
      type: 'line',
      source: SRC_ROUTE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': track, 'line-width': 3 },
    });
    map.addLayer({
      id: SRC_ROUTE_PREVIEW,
      type: 'line',
      source: SRC_ROUTE_PREVIEW,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': track, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.85 },
    });
  }
  const setData = (id, data) => map.getSource(id)?.setData(data);

  let mode = null; // null | 'site' | 'route' | 'point'
  let routeDraw = []; // [[lng,lat], …] in-progress route vertices
  let popup = null;

  const siteMarkers = new Map(); // id -> marker
  const pointMarkers = new Map(); // id -> marker
  let routeVertexMarkers = []; // marker[]

  // ── Hint text per mode ─────────────────────────────────────────────────
  function hintFor(m) {
    if (m === 'site') return 'Click to place a site · Esc to finish.';
    if (m === 'point') return 'Click to place a demand point · Esc to finish.';
    if (m === 'route') {
      return routeDraw.length >= 2
        ? 'Click to add points · double-click or Enter to finish · Backspace to undo · Esc to cancel.'
        : 'Click to start the route · Backspace to undo · Esc to cancel.';
    }
    return '';
  }
  const showHint = () => onHint?.(hintFor(mode));

  // ── Mode ────────────────────────────────────────────────────────────────
  function setMode(next) {
    if (next === mode) next = null;
    if (mode === 'route' && next !== 'route') cancelRoute();
    mode = next;
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
    if (mode === 'route') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    closePopup();
    showHint();
    onModeChange?.(mode);
    return mode;
  }

  // ── Markers ───────────────────────────────────────────────────────────
  function makeMarker(kind, lngLat, draggable = true) {
    const el = document.createElement('div');
    el.className = `mission-marker mission-marker--${kind}`;
    return new maplibregl.Marker({ element: el, draggable }).setLngLat(lngLat).addTo(map);
  }

  function attachSite(site) {
    const m = makeMarker('site', [site.lng, site.lat]);
    const el = m.getElement();
    el.title = site.name || 'Site';
    m.on('dragend', () => {
      const p = m.getLngLat();
      mission.moveSite(site.id, p.lat, p.lng);
    });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (mode) return; // don't open delete popups while placing
      openDeletePopup([site.lng, site.lat], site.name || 'Site', () => {
        mission.removeSite(site.id);
        refresh();
      }, {
        editable: true,
        name: site.name || '',
        placeholder: 'Site name',
        onRename: (v) => { mission.renameSite(site.id, v); el.title = v || 'Site'; },
      });
    });
    siteMarkers.set(site.id, m);
  }

  function attachPoint(pt) {
    const m = makeMarker('point', [pt.lng, pt.lat]);
    const el = m.getElement();
    el.title = pt.name || 'Demand point';
    m.on('dragend', () => {
      const p = m.getLngLat();
      mission.movePoint(pt.id, p.lat, p.lng);
    });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (mode) return;
      openDeletePopup([pt.lng, pt.lat], pt.name || 'Demand point', () => {
        mission.removePoint(pt.id);
        refresh();
      }, {
        editable: true,
        name: pt.name || '',
        placeholder: 'Point name',
        onRename: (v) => { mission.renamePoint(pt.id, v); el.title = v || 'Demand point'; },
      });
    });
    pointMarkers.set(pt.id, m);
  }

  function attachRouteVertices() {
    routeVertexMarkers.forEach((m) => m.remove());
    routeVertexMarkers = [];
    const route = mission.state.route;
    route.forEach((v, i) => {
      const m = makeMarker('vertex', [v.lng, v.lat]);
      m.on('drag', () => {
        const p = m.getLngLat();
        mission.state.route[i] = { lat: p.lat, lng: p.lng };
        drawCommittedRoute();
      });
      m.on('dragend', () => {
        const p = m.getLngLat();
        mission.updateRouteVertex(i, p.lat, p.lng);
      });
      m.getElement().addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (mode) return;
        openDeletePopup([v.lng, v.lat], `Vertex ${i + 1}`, () => {
          mission.removeRouteVertex(i);
          refresh();
        });
      });
      routeVertexMarkers.push(m);
    });
  }

  function drawCommittedRoute() {
    const coords = mission.state.route.map((v) => [v.lng, v.lat]);
    setData(SRC_ROUTE, coords.length >= 2 ? fc([lineFeat(coords)]) : fc([]));
  }

  /** Rebuild every marker + the route line from the model. */
  function refresh() {
    siteMarkers.forEach((m) => m.remove());
    siteMarkers.clear();
    pointMarkers.forEach((m) => m.remove());
    pointMarkers.clear();
    for (const s of mission.state.sites) attachSite(s);
    for (const p of mission.state.points) attachPoint(p);
    drawCommittedRoute();
    attachRouteVertices();
  }

  // ── Delete popup ──────────────────────────────────────────────────────
  function openDeletePopup(lngLat, label, onDelete, opts = {}) {
    closePopup();
    const coordText = formatCoord ? formatCoord(lngLat) : `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
    const wrap = document.createElement('div');
    wrap.className = 'mission-popup';
    wrap.innerHTML =
      (opts.editable
        ? `<input type="text" class="mission-popup__edit" aria-label="Name" />`
        : `<span class="mission-popup__name"></span>`) +
      `<button type="button" class="mission-popup__del" aria-label="Delete">×</button>` +
      `<span class="mission-popup__coord" data-numeric></span>` +
      `<button type="button" class="mission-popup__copy" title="Copy coordinate">Copy</button>`;
    if (opts.editable) {
      const input = wrap.querySelector('.mission-popup__edit');
      input.value = opts.name || '';
      input.placeholder = opts.placeholder || 'Name';
      input.addEventListener('change', () => opts.onRename?.(input.value.trim()));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // don't reach the map's route keys (Enter / Backspace / Esc)
        if (e.key === 'Enter') { e.preventDefault(); opts.onRename?.(input.value.trim()); closePopup(); }
        else if (e.key === 'Escape') closePopup();
      });
    } else {
      wrap.querySelector('.mission-popup__name').textContent = label;
    }
    wrap.querySelector('.mission-popup__coord').textContent = coordText;
    wrap.querySelector('.mission-popup__del').addEventListener('click', () => { closePopup(); onDelete(); });
    wrap.querySelector('.mission-popup__copy').addEventListener('click', () => {
      try { navigator.clipboard?.writeText(coordText); onStatus?.('Coordinate copied'); } catch { /* clipboard unavailable */ }
    });
    popup = new maplibregl.Popup({ closeButton: false, offset: 16 })
      .setLngLat(lngLat)
      .setDOMContent(wrap)
      .addTo(map);
  }
  function closePopup() {
    popup?.remove();
    popup = null;
  }

  // ── Route drawing ─────────────────────────────────────────────────────
  function previewRoute(extra) {
    const coords = extra ? [...routeDraw, extra] : routeDraw.slice();
    setData(SRC_ROUTE_PREVIEW, coords.length >= 2 ? fc([lineFeat(coords)]) : fc([]));
  }
  function cancelRoute() {
    routeDraw = [];
    setData(SRC_ROUTE_PREVIEW, fc([]));
  }
  function finishRoute() {
    if (routeDraw.length >= 2) {
      mission.setRoute(routeDraw.map(([lng, lat]) => ({ lat, lng })));
      onStatus?.(`Route set · ${routeDraw.length} vertices`);
    }
    cancelRoute();
    setMode(null);
    refresh();
  }

  // ── Map interaction ───────────────────────────────────────────────────
  function onClick(e) {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (mode === 'site') {
      mission.addSite(e.lngLat.lat, e.lngLat.lng);
      refresh();
    } else if (mode === 'point') {
      mission.addPoint(e.lngLat.lat, e.lngLat.lng);
      refresh();
    } else if (mode === 'route') {
      routeDraw.push(ll);
      previewRoute();
      showHint();
    }
  }
  function onMove(e) {
    if (mode === 'route' && routeDraw.length) previewRoute([e.lngLat.lng, e.lngLat.lat]);
  }
  function onDbl(e) {
    if (mode === 'route' && routeDraw.length >= 2) {
      e.preventDefault?.();
      finishRoute();
    }
  }
  function onKey(e) {
    if (!mode) return;
    if (e.key === 'Escape') {
      if (mode === 'route') cancelRoute();
      setMode(null);
    } else if (mode === 'route' && e.key === 'Enter' && routeDraw.length >= 2) {
      finishRoute();
    } else if (mode === 'route' && e.key === 'Backspace') {
      e.preventDefault();
      routeDraw.pop();
      previewRoute();
      showHint();
    }
  }

  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('dblclick', onDbl);
  document.addEventListener('keydown', onKey);

  return {
    setMode,
    getMode: () => mode,
    refresh,
    clearType(type) {
      if (type === 'sites') mission.clearSites();
      else if (type === 'points') mission.clearPoints();
      else if (type === 'route') mission.clearRoute();
      refresh();
    },
    destroy() {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('dblclick', onDbl);
      document.removeEventListener('keydown', onKey);
      closePopup();
      siteMarkers.forEach((m) => m.remove());
      pointMarkers.forEach((m) => m.remove());
      routeVertexMarkers.forEach((m) => m.remove());
      if (map.getLayer(SRC_ROUTE)) map.removeLayer(SRC_ROUTE);
      if (map.getLayer(SRC_ROUTE_PREVIEW)) map.removeLayer(SRC_ROUTE_PREVIEW);
      if (map.getSource(SRC_ROUTE)) map.removeSource(SRC_ROUTE);
      if (map.getSource(SRC_ROUTE_PREVIEW)) map.removeSource(SRC_ROUTE_PREVIEW);
    },
  };
}
