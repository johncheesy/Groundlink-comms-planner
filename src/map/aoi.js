import L from 'leaflet';

/**
 * AOI (area of interest) drawing — radius circle + polygon.
 *
 * Deliberately dependency-light: built on Leaflet primitives rather than
 * leaflet-draw, so we control the styling (dashed azure boundary, teal vertex
 * handles) and the interaction precisely.
 *
 * Modes:
 *   - 'radius':  click to drop the centre, move to size it, click to commit.
 *   - 'polygon': click to add vertices, double-click / Enter to finish,
 *                Esc / right-click to cancel the in-progress shape.
 *
 * One AOI at a time (M1). Emits onChange with a summary {type, ...metrics}.
 */

/**
 * Resolve a CSS custom property to its computed value.
 * Leaflet writes `color`/`fillColor` as SVG *presentation attributes*
 * (`stroke="…"`), where CSS `var()` does NOT resolve — so we must pass real
 * colour values. The on-map feature colours are theme-independent constants
 * (see docs/design-tokens.md), so resolving once is correct.
 */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function createAoiController(map, { onChange, onHint } = {}) {
  // theme-independent map-feature colours, resolved from tokens
  const track = cssVar('--feat-track', '#46a6ff'); // azure — AOI boundary
  const site = cssVar('--feat-site', '#34e6c2'); // teal — AOI fill

  const AOI_STYLE = {
    // dashed azure boundary, faint teal fill — reads on the dark map
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
  let mode = null; // null | 'radius' | 'polygon'
  let committed = null; // { type, layer, ... }

  // transient drawing state
  let radiusCenter = null;
  let polyPoints = [];
  let preview = null; // preview shape
  let rubberLine = null; // polygon rubber-band segment to cursor
  let vertexMarkers = [];

  function emit() {
    onChange?.(summary());
  }

  function summary() {
    if (!committed) return { type: null };
    if (committed.type === 'radius') {
      const r = committed.layer.getRadius();
      return {
        type: 'radius',
        radiusM: r,
        areaM2: Math.PI * r * r,
        center: committed.layer.getLatLng(),
      };
    }
    const latlngs = committed.layer.getLatLngs()[0];
    return {
      type: 'polygon',
      vertices: latlngs.length,
      areaM2: polygonAreaM2(latlngs),
      perimeterM: polygonPerimeterM(latlngs),
    };
  }

  function setHint(text) {
    onHint?.(text || '');
  }

  // ---- lifecycle --------------------------------------------------------

  function clearTransient() {
    if (preview) {
      layer.removeLayer(preview);
      preview = null;
    }
    if (rubberLine) {
      layer.removeLayer(rubberLine);
      rubberLine = null;
    }
    vertexMarkers.forEach((m) => layer.removeLayer(m));
    vertexMarkers = [];
    radiusCenter = null;
    polyPoints = [];
  }

  function clearAll() {
    clearTransient();
    if (committed) {
      layer.removeLayer(committed.layer);
      committed = null;
    }
    emit();
  }

  function setMode(next) {
    // toggling the active mode off
    if (next === mode) next = null;
    clearTransient();
    mode = next;

    // Leaflet's dblclick-zoom fights polygon finishing — disable while drawing.
    if (mode === 'polygon') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    map.getContainer().style.cursor = mode ? 'crosshair' : '';
    if (mode === 'radius') {
      setHint('Click to set the centre, then click again to set the radius.');
    } else if (mode === 'polygon') {
      setHint('Click to add points · double-click or Enter to finish · Esc to cancel.');
    } else {
      setHint('');
    }
    return mode;
  }

  function commit(type, shapeLayer) {
    if (committed) layer.removeLayer(committed.layer);
    committed = { type, layer: shapeLayer.setStyle(AOI_STYLE) };
    clearTransient();
    setMode(null);
    emit();
  }

  // ---- radius -----------------------------------------------------------

  function radiusClick(e) {
    if (!radiusCenter) {
      radiusCenter = e.latlng;
      preview = L.circle(radiusCenter, { radius: 1, ...PREVIEW_STYLE }).addTo(layer);
      addVertex(radiusCenter);
      setHint('Move out, then click to set the radius.');
    } else {
      const r = map.distance(radiusCenter, e.latlng);
      const circle = L.circle(radiusCenter, { radius: Math.max(r, 1) });
      circle.addTo(layer);
      commit('radius', circle);
    }
  }

  function radiusMove(e) {
    if (!radiusCenter || !preview) return;
    preview.setRadius(Math.max(map.distance(radiusCenter, e.latlng), 1));
  }

  // ---- polygon ----------------------------------------------------------

  function polygonClick(e) {
    polyPoints.push(e.latlng);
    addVertex(e.latlng);
    if (polyPoints.length >= 2) {
      if (preview) layer.removeLayer(preview);
      preview = L.polygon(polyPoints, PREVIEW_STYLE).addTo(layer);
    }
    setHint(
      polyPoints.length >= 3
        ? 'Double-click or press Enter to finish · Esc to cancel.'
        : 'Click to add points · Esc to cancel.',
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
  }

  function finishPolygon() {
    if (polyPoints.length < 3) return;
    const poly = L.polygon(polyPoints, {}).addTo(layer);
    commit('polygon', poly);
  }

  // ---- vertex handles ---------------------------------------------------

  function addVertex(latlng) {
    const m = L.marker(latlng, {
      icon: L.divIcon({ className: 'aoi-vertex', iconSize: [11, 11] }),
      interactive: false,
      keyboard: false,
    }).addTo(layer);
    vertexMarkers.push(m);
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

  function onMapDblClick(e) {
    if (mode === 'polygon') {
      // Leaflet would otherwise zoom on dblclick while drawing
      finishPolygon();
    }
  }

  function onKey(e) {
    if (!mode) return;
    if (e.key === 'Enter' && mode === 'polygon') finishPolygon();
    else if (e.key === 'Escape') {
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

  // Suppress the default dblclick-zoom only while actively drawing a polygon.
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

/** Spherical polygon area in m² (absolute value of the spherical excess). */
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
    const a = latlngs[i];
    const b = latlngs[(i + 1) % latlngs.length];
    total += L.latLng(a).distanceTo(L.latLng(b));
  }
  return total;
}
