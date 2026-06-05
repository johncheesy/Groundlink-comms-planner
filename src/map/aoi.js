import L from 'leaflet';

/**
 * AOI (area of interest) drawing + editing — radius circle and polygon.
 *
 * Dependency-light: built on Leaflet primitives (no leaflet-draw), so styling
 * and interaction are fully under our control and match the design tokens.
 *
 * Drawing:
 *   - 'radius':  click centre, move to size (live tooltip), click to commit.
 *   - 'polygon': click to add vertices (live tooltip), Backspace removes the
 *                last point, double-click / Enter finishes, Esc cancels.
 *
 * Editing (after commit, no tool active):
 *   - circle:  drag the centre handle to move, the edge handle to resize.
 *   - polygon: drag any vertex handle to reshape.
 *   Metrics recompute live and are pushed through onChange.
 *
 * One AOI at a time (M1). Emits onChange with {type, ...metrics}.
 */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const fmtArea = (m2) => {
  const km2 = m2 / 1e6;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²`;
  return `${(m2 / 1e4).toFixed(1)} ha`;
};

export function createAoiController(map, { onChange, onHint } = {}) {
  // theme-independent map-feature colours, resolved from tokens (Leaflet writes
  // these as SVG presentation attributes, where CSS var() does NOT resolve).
  const track = cssVar('--feat-track', '#46a6ff'); // azure — AOI boundary
  const site = cssVar('--feat-site', '#34e6c2'); // teal — AOI fill

  const AOI_STYLE = {
    color: track,
    weight: 2,
    dashArray: '6 5',
    fillColor: site,
    fillOpacity: 0.08,
  };
  const PREVIEW_STYLE = {
    color: track,
    weight: 1.5,
    dashArray: '4 4',
    fillColor: site,
    fillOpacity: 0.05,
    interactive: false,
  };

  const layer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);

  let mode = null; // null | 'radius' | 'polygon'
  let committed = null; // { type, layer }

  // transient drawing state
  let radiusCenter = null;
  let polyPoints = [];
  let preview = null;
  let rubberLine = null;
  let vertexMarkers = [];
  let measureTip = null; // L.tooltip following the cursor while drawing

  // ---- summary / emit ---------------------------------------------------

  function summary() {
    if (!committed) return { type: null };
    if (committed.type === 'radius') {
      const r = committed.layer.getRadius();
      return { type: 'radius', radiusM: r, areaM2: Math.PI * r * r, center: committed.layer.getLatLng() };
    }
    const latlngs = committed.layer.getLatLngs()[0];
    return {
      type: 'polygon',
      vertices: latlngs.length,
      areaM2: polygonAreaM2(latlngs),
      perimeterM: polygonPerimeterM(latlngs),
    };
  }

  const emit = () => onChange?.(summary());
  const setHint = (text) => onHint?.(text || '');

  // ---- measure tooltip --------------------------------------------------

  function showMeasure(latlng, text) {
    if (!measureTip) {
      measureTip = L.tooltip({
        permanent: true,
        direction: 'top',
        offset: [0, -10],
        className: 'aoi-measure',
        opacity: 1,
      });
      measureTip.setLatLng(latlng).setContent(text).addTo(map);
      return;
    }
    measureTip.setLatLng(latlng).setContent(text);
  }
  function hideMeasure() {
    if (measureTip) {
      map.removeLayer(measureTip);
      measureTip = null;
    }
  }

  // ---- lifecycle --------------------------------------------------------

  function clearTransient() {
    [preview, rubberLine].forEach((l) => l && layer.removeLayer(l));
    preview = null;
    rubberLine = null;
    vertexMarkers.forEach((m) => layer.removeLayer(m));
    vertexMarkers = [];
    radiusCenter = null;
    polyPoints = [];
    hideMeasure();
  }

  function clearEditHandles() {
    editLayer.clearLayers();
  }

  function clearAll() {
    clearTransient();
    clearEditHandles();
    if (committed) {
      layer.removeLayer(committed.layer);
      committed = null;
    }
    emit();
  }

  function setMode(next) {
    if (next === mode) next = null; // toggle off
    clearTransient();
    mode = next;

    if (mode === 'polygon') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    map.getContainer().style.cursor = mode ? 'crosshair' : '';
    if (mode === 'radius') setHint('Click to set the centre, then click again to set the radius.');
    else if (mode === 'polygon') setHint('Click to add points · Backspace to undo · double-click or Enter to finish · Esc to cancel.');
    else setHint('');
    return mode;
  }

  function commit(type, shapeLayer) {
    if (committed) layer.removeLayer(committed.layer);
    committed = { type, layer: shapeLayer.setStyle(AOI_STYLE) };
    clearTransient();
    setMode(null);
    buildEditHandles();
    emit();
  }

  // ---- radius drawing ---------------------------------------------------

  function radiusClick(e) {
    if (!radiusCenter) {
      radiusCenter = e.latlng;
      preview = L.circle(radiusCenter, { radius: 1, ...PREVIEW_STYLE }).addTo(layer);
      addVertex(radiusCenter, layer);
      setHint('Move out, then click to set the radius.');
    } else {
      const r = Math.max(map.distance(radiusCenter, e.latlng), 1);
      commit('radius', L.circle(radiusCenter, { radius: r }).addTo(layer));
    }
  }

  function radiusMove(e) {
    if (!radiusCenter || !preview) return;
    const r = Math.max(map.distance(radiusCenter, e.latlng), 1);
    preview.setRadius(r);
    showMeasure(e.latlng, `r ${fmtKm(r)} · ${fmtArea(Math.PI * r * r)}`);
  }

  // ---- polygon drawing --------------------------------------------------

  function polygonClick(e) {
    polyPoints.push(e.latlng);
    addVertex(e.latlng, layer);
    redrawPolyPreview();
    setHint(
      polyPoints.length >= 3
        ? 'Double-click or Enter to finish · Backspace to undo · Esc to cancel.'
        : 'Click to add points · Backspace to undo · Esc to cancel.',
    );
  }

  function polygonMove(e) {
    if (polyPoints.length === 0) return;
    const last = polyPoints[polyPoints.length - 1];
    if (rubberLine) layer.removeLayer(rubberLine);
    rubberLine = L.polyline([last, e.latlng], {
      color: track,
      weight: 1.5,
      dashArray: '3 5',
      opacity: 0.7,
      interactive: false,
    }).addTo(layer);

    const seg = map.distance(last, e.latlng);
    const text =
      polyPoints.length >= 2
        ? `${polyPoints.length} pts · ${fmtArea(polygonAreaM2([...polyPoints, e.latlng]))}`
        : `seg ${fmtKm(seg)}`;
    showMeasure(e.latlng, text);
  }

  function redrawPolyPreview() {
    if (preview) layer.removeLayer(preview);
    if (polyPoints.length >= 2) preview = L.polygon(polyPoints, PREVIEW_STYLE).addTo(layer);
    else preview = null;
  }

  function undoPolyPoint() {
    if (mode !== 'polygon' || polyPoints.length === 0) return;
    polyPoints.pop();
    const m = vertexMarkers.pop();
    if (m) layer.removeLayer(m);
    redrawPolyPreview();
    if (rubberLine) {
      layer.removeLayer(rubberLine);
      rubberLine = null;
    }
    if (polyPoints.length === 0) hideMeasure();
  }

  function finishPolygon() {
    if (polyPoints.length < 3) return;
    commit('polygon', L.polygon(polyPoints, {}).addTo(layer));
  }

  // ---- vertex dots (non-interactive, during drawing) --------------------

  function addVertex(latlng, group) {
    const m = L.marker(latlng, {
      icon: L.divIcon({ className: 'aoi-vertex', iconSize: [11, 11] }),
      interactive: false,
      keyboard: false,
    }).addTo(group);
    vertexMarkers.push(m);
  }

  // ---- editable handles (after commit) ----------------------------------

  function handleIcon(kind) {
    return L.divIcon({ className: `aoi-handle aoi-handle--${kind}`, iconSize: [14, 14] });
  }

  function buildEditHandles() {
    clearEditHandles();
    if (!committed) return;
    if (committed.type === 'radius') buildRadiusHandles();
    else buildPolygonHandles();
  }

  function buildRadiusHandles() {
    const circle = committed.layer;
    const center = circle.getLatLng();
    const radius = circle.getRadius();
    const edge = edgePoint(center, radius);

    const centerH = L.marker(center, { icon: handleIcon('center'), draggable: true, title: 'Move centre' }).addTo(editLayer);
    const edgeH = L.marker(edge, { icon: handleIcon('edge'), draggable: true, title: 'Resize' }).addTo(editLayer);

    centerH.on('drag', () => {
      const c = centerH.getLatLng();
      circle.setLatLng(c);
      edgeH.setLatLng(edgePoint(c, circle.getRadius()));
      emit();
    });
    edgeH.on('drag', () => {
      const r = Math.max(map.distance(circle.getLatLng(), edgeH.getLatLng()), 1);
      circle.setRadius(r);
      emit();
    });
    edgeH.on('dragend', () => edgeH.setLatLng(edgePoint(circle.getLatLng(), circle.getRadius())));
  }

  function buildPolygonHandles() {
    const poly = committed.layer;
    const latlngs = poly.getLatLngs()[0];
    latlngs.forEach((ll, i) => {
      const h = L.marker(ll, { icon: handleIcon('vertex'), draggable: true, title: 'Drag to reshape' }).addTo(editLayer);
      h.on('drag', () => {
        const pts = poly.getLatLngs()[0].slice();
        pts[i] = h.getLatLng();
        poly.setLatLngs(pts);
        emit();
      });
    });
  }

  // east-bearing point at distance `radius` from `center`
  function edgePoint(center, radius) {
    const dLng = (radius / (R * Math.cos(rad(center.lat)))) * (180 / Math.PI);
    return L.latLng(center.lat, center.lng + dLng);
  }

  // ---- map event routing ------------------------------------------------

  function onMapClick(e) {
    if (mode === 'radius') radiusClick(e);
    else if (mode === 'polygon') polygonClick(e);
  }
  function onMapMove(e) {
    if (mode === 'radius') radiusMove(e);
    else if (mode === 'polygon') polygonMove(e);
  }
  function onMapDblClick() {
    if (mode === 'polygon') finishPolygon();
  }
  function onKey(e) {
    if (!mode) return;
    if (e.key === 'Enter' && mode === 'polygon') finishPolygon();
    else if (e.key === 'Backspace') {
      e.preventDefault();
      undoPolyPoint();
    } else if (e.key === 'Escape') {
      clearTransient();
      setMode(null);
    }
  }
  function onContextMenu(e) {
    if (mode === 'polygon') {
      L.DomEvent.preventDefault(e);
      clearTransient();
      setMode(null);
    }
  }

  map.on('click', onMapClick);
  map.on('mousemove', onMapMove);
  map.on('dblclick', onMapDblClick);
  map.on('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKey);

  return {
    setMode,
    getMode: () => mode,
    clear: clearAll,
    summary,
    /** Fit the map to the committed AOI, if any. */
    fitBounds(opts = { padding: [40, 40] }) {
      if (!committed) return false;
      const b = committed.type === 'radius' ? committed.layer.getBounds() : committed.layer.getBounds();
      map.fitBounds(b, opts);
      return true;
    },
    destroy() {
      map.off('click', onMapClick);
      map.off('mousemove', onMapMove);
      map.off('dblclick', onMapDblClick);
      map.off('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKey);
      clearAll();
      map.doubleClickZoom.enable();
    },
  };
}

// ---- geodesic metrics ---------------------------------------------------

const R = 6378137; // earth radius, metres (WGS84)
const rad = (d) => (d * Math.PI) / 180;

/** Spherical polygon area in m² (absolute spherical excess). */
function polygonAreaM2(latlngs) {
  if (latlngs.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const a = latlngs[i];
    const b = latlngs[(i + 1) % latlngs.length];
    total += rad(b.lng - a.lng) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
  }
  return Math.abs((total * R * R) / 2);
}

function polygonPerimeterM(latlngs) {
  let total = 0;
  for (let i = 0; i < latlngs.length; i++) {
    total += L.latLng(latlngs[i]).distanceTo(L.latLng(latlngs[(i + 1) % latlngs.length]));
  }
  return total;
}
