import maplibregl from 'maplibre-gl';

/**
 * AOI drawing + editing for MapLibre GL — radius circle and polygon.
 *
 * Geometry lives in GeoJSON sources; a radius is stored as its centre + radius
 * and rendered as a 72-point geodesic circle. Editing uses draggable DOM
 * markers (circle centre/edge, polygon vertices). No external draw plugin.
 *
 *   - 'radius':  click centre, move to size (live tooltip), click to commit.
 *   - 'polygon': click vertices, Backspace undo, dbl-click / Enter finish, Esc cancel.
 *
 * One AOI at a time. Emits onChange({type, ...metrics}); onHint(text) for the
 * on-map drawing hint. Call only after the map style has loaded.
 */

const SRC_AOI = 'aoi';
const SRC_PREVIEW = 'aoi-preview';
const SRC_VERTS = 'aoi-verts';

const R = 6378137;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const fmtArea = (m2) => {
  const km2 = m2 / 1e6;
  return km2 >= 1 ? `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²` : `${(m2 / 1e4).toFixed(1)} ha`;
};

// ---- geodesy ------------------------------------------------------------
function distM(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function destination(origin, bearingDeg, dist) {
  const br = toRad(bearingDeg);
  const lat1 = toRad(origin[1]);
  const lng1 = toRad(origin[0]);
  const dr = dist / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return [toDeg(lng2), toDeg(lat2)];
}
function circleRing(center, radiusM, steps = 72) {
  const ring = [];
  for (let i = 0; i <= steps; i++) ring.push(destination(center, (i / steps) * 360, radiusM));
  return ring;
}
function ringAreaM2(coords) {
  if (coords.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    total += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  return Math.abs((total * R * R) / 2);
}
function ringPerimeterM(coords) {
  let t = 0;
  for (let i = 0; i < coords.length; i++) t += distM(coords[i], coords[(i + 1) % coords.length]);
  return t;
}
function bboxOf(coords) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

const fc = (features) => ({ type: 'FeatureCollection', features });
const poly = (ring) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} });
const lineFeat = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });

export function createAoiController(map, { onChange, onHint } = {}) {
  const track = cssVar('--feat-track', '#46a6ff');
  const site = cssVar('--feat-site', '#34e6c2');

  // ---- sources + layers (once) -----------------------------------------
  if (!map.getSource(SRC_AOI)) {
    map.addSource(SRC_AOI, { type: 'geojson', data: fc([]) });
    map.addSource(SRC_PREVIEW, { type: 'geojson', data: fc([]) });
    map.addSource(SRC_VERTS, { type: 'geojson', data: fc([]) });

    map.addLayer({ id: 'aoi-fill', type: 'fill', source: SRC_AOI, paint: { 'fill-color': site, 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'aoi-line', type: 'line', source: SRC_AOI, paint: { 'line-color': track, 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'aoi-preview-fill', type: 'fill', source: SRC_PREVIEW, paint: { 'fill-color': site, 'fill-opacity': 0.05 } });
    map.addLayer({ id: 'aoi-preview-line', type: 'line', source: SRC_PREVIEW, paint: { 'line-color': track, 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
    map.addLayer({
      id: 'aoi-verts',
      type: 'circle',
      source: SRC_VERTS,
      paint: { 'circle-radius': 4, 'circle-color': site, 'circle-stroke-color': '#0b1018', 'circle-stroke-width': 2 },
    });
  }

  const setData = (id, data) => map.getSource(id)?.setData(data);

  let mode = null; // null | 'radius' | 'polygon'
  let committed = null; // { type, ring, center?, radiusM? }
  let radiusCenter = null; // [lng,lat]
  let polyPoints = []; // [[lng,lat]]
  let handles = []; // maplibregl.Marker[]
  let measureMarker = null;
  let measureEl = null;

  // ---- summary / emit ---------------------------------------------------
  function summary() {
    if (!committed) return { type: null };
    if (committed.type === 'radius') {
      const r = committed.radiusM;
      return { type: 'radius', radiusM: r, areaM2: Math.PI * r * r };
    }
    return { type: 'polygon', vertices: committed.ring.length, areaM2: ringAreaM2(committed.ring), perimeterM: ringPerimeterM(committed.ring) };
  }
  const emit = () => onChange?.(summary());
  const setHint = (t) => onHint?.(t || '');

  // ---- measure tooltip --------------------------------------------------
  function showMeasure(lngLat, text) {
    if (!measureMarker) {
      measureEl = document.createElement('div');
      measureEl.className = 'aoi-measure';
      measureMarker = new maplibregl.Marker({ element: measureEl, anchor: 'bottom', offset: [0, -12] })
        .setLngLat(lngLat)
        .addTo(map);
    }
    measureEl.textContent = text;
    measureMarker.setLngLat(lngLat);
  }
  function hideMeasure() {
    measureMarker?.remove();
    measureMarker = null;
    measureEl = null;
  }

  // ---- handles ----------------------------------------------------------
  function clearHandles() {
    handles.forEach((m) => m.remove());
    handles = [];
  }
  function makeHandle(kind, lngLat) {
    const el = document.createElement('div');
    el.className = `aoi-handle aoi-handle--${kind}`;
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lngLat).addTo(map);
    handles.push(m);
    return m;
  }

  function buildHandles() {
    clearHandles();
    if (!committed) return;
    if (committed.type === 'radius') {
      const centerH = makeHandle('center', committed.center);
      const edgeH = makeHandle('edge', destination(committed.center, 90, committed.radiusM));
      centerH.on('drag', () => {
        const c = centerH.getLngLat();
        committed.center = [c.lng, c.lat];
        edgeH.setLngLat(destination(committed.center, 90, committed.radiusM));
        refreshRadius();
      });
      edgeH.on('drag', () => {
        const e = edgeH.getLngLat();
        committed.radiusM = Math.max(distM(committed.center, [e.lng, e.lat]), 1);
        refreshRadius();
      });
      edgeH.on('dragend', () => edgeH.setLngLat(destination(committed.center, 90, committed.radiusM)));
    } else {
      committed.ring.forEach((pt, i) => {
        const h = makeHandle('vertex', pt);
        h.on('drag', () => {
          const p = h.getLngLat();
          committed.ring[i] = [p.lng, p.lat];
          setData(SRC_AOI, fc([poly(committed.ring)]));
          emit();
        });
      });
    }
  }
  function refreshRadius() {
    committed.ring = circleRing(committed.center, committed.radiusM);
    setData(SRC_AOI, fc([poly(committed.ring)]));
    emit();
  }

  // ---- lifecycle --------------------------------------------------------
  function clearTransient() {
    radiusCenter = null;
    polyPoints = [];
    setData(SRC_PREVIEW, fc([]));
    setData(SRC_VERTS, fc([]));
    hideMeasure();
  }
  function clearAll() {
    clearTransient();
    clearHandles();
    committed = null;
    setData(SRC_AOI, fc([]));
    emit();
  }
  function setMode(next) {
    if (next === mode) next = null;
    clearTransient();
    mode = next;
    if (mode === 'polygon') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
    if (mode === 'radius') setHint('Click to set the centre, then click again to set the radius.');
    else if (mode === 'polygon') setHint('Click to add points · Backspace to undo · double-click or Enter to finish · Esc to cancel.');
    else setHint('');
    return mode;
  }
  function commitRadius(center, radiusM) {
    committed = { type: 'radius', center, radiusM, ring: circleRing(center, radiusM) };
    setData(SRC_AOI, fc([poly(committed.ring)]));
    clearTransient();
    setMode(null);
    buildHandles();
    emit();
  }
  function commitPolygon(points) {
    committed = { type: 'polygon', ring: points.slice() };
    setData(SRC_AOI, fc([poly(committed.ring)]));
    clearTransient();
    setMode(null);
    buildHandles();
    emit();
  }

  // ---- drawing ----------------------------------------------------------
  function onClick(e) {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (mode === 'radius') {
      if (!radiusCenter) {
        radiusCenter = ll;
        setData(SRC_VERTS, fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: ll }, properties: {} }]));
        setHint('Move out, then click to set the radius.');
      } else {
        commitRadius(radiusCenter, Math.max(distM(radiusCenter, ll), 1));
      }
    } else if (mode === 'polygon') {
      polyPoints.push(ll);
      setData(SRC_VERTS, fc(polyPoints.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))));
      if (polyPoints.length >= 2) setData(SRC_PREVIEW, fc([poly(polyPoints)]));
      setHint(polyPoints.length >= 3 ? 'Double-click or Enter to finish · Backspace to undo · Esc to cancel.' : 'Click to add points · Backspace to undo · Esc to cancel.');
    }
  }
  function onMove(e) {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (mode === 'radius' && radiusCenter) {
      const r = Math.max(distM(radiusCenter, ll), 1);
      setData(SRC_PREVIEW, fc([poly(circleRing(radiusCenter, r))]));
      showMeasure(ll, `r ${fmtKm(r)} · ${fmtArea(Math.PI * r * r)}`);
    } else if (mode === 'polygon' && polyPoints.length) {
      const rubber = [...polyPoints, ll];
      setData(SRC_PREVIEW, fc([poly(rubber), lineFeat([polyPoints[polyPoints.length - 1], ll])]));
      const text = polyPoints.length >= 2 ? `${polyPoints.length} pts · ${fmtArea(ringAreaM2(rubber))}` : `seg ${fmtKm(distM(polyPoints[polyPoints.length - 1], ll))}`;
      showMeasure(ll, text);
    }
  }
  function onDbl(e) {
    if (mode === 'polygon' && polyPoints.length >= 3) {
      e.preventDefault?.();
      commitPolygon(polyPoints);
    }
  }
  function undoPoint() {
    if (mode !== 'polygon' || !polyPoints.length) return;
    polyPoints.pop();
    setData(SRC_VERTS, fc(polyPoints.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))));
    setData(SRC_PREVIEW, polyPoints.length >= 2 ? fc([poly(polyPoints)]) : fc([]));
    if (!polyPoints.length) hideMeasure();
  }
  function onKey(e) {
    if (!mode) return;
    if (e.key === 'Enter' && mode === 'polygon' && polyPoints.length >= 3) commitPolygon(polyPoints);
    else if (e.key === 'Backspace') {
      e.preventDefault();
      undoPoint();
    } else if (e.key === 'Escape') {
      clearTransient();
      setMode(null);
    }
  }
  function onContext(e) {
    if (mode === 'polygon') {
      e.preventDefault();
      clearTransient();
      setMode(null);
    }
  }

  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('dblclick', onDbl);
  map.on('contextmenu', onContext);
  document.addEventListener('keydown', onKey);

  return {
    setMode,
    getMode: () => mode,
    clear: clearAll,
    summary,
    getAoi() {
      if (!committed) return null;
      const b = bboxOf(committed.ring);
      const center = committed.type === 'radius' ? committed.center : [(b.west + b.east) / 2, (b.south + b.north) / 2];
      return { type: committed.type, center: { lat: center[1], lng: center[0] }, bounds: b };
    },
    fitBounds(opts = { padding: 60 }) {
      if (!committed) return false;
      const b = bboxOf(committed.ring);
      map.fitBounds([[b.west, b.south], [b.east, b.north]], opts);
      return true;
    },
    destroy() {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('dblclick', onDbl);
      map.off('contextmenu', onContext);
      document.removeEventListener('keydown', onKey);
      clearAll();
      map.doubleClickZoom.enable();
    },
  };
}
