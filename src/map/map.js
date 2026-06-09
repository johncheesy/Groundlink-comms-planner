import maplibregl from 'maplibre-gl';
import {
  buildStyle,
  BASEMAPS,
  BASEMAP_VARIANTS,
  DEFAULT_BASEMAP,
  TERRARIUM_DEM,
  BUILDINGS_LAYER,
  variantLayerId,
} from './basemaps.js';

/**
 * Initialise the MapLibre GL map.
 *
 * Basemap switching toggles raster-layer visibility (runtime layers such as
 * AOI and coverage are preserved). Each basemap category (imagery, topo) can
 * have multiple variant tile sources; setBasemap(category, variantId) handles
 * both category switches and intra-category variant switches.
 */
export function initMap(container) {
  // Initial active state
  let activeCategory = DEFAULT_BASEMAP;
  const activeVariantIds = Object.fromEntries(
    BASEMAPS.map((cat) => [cat, BASEMAP_VARIANTS[cat][0].id]),
  );

  const map = new maplibregl.Map({
    container,
    style: buildStyle(activeCategory, activeVariantIds),
    center: [4.9041, 52.3676], // [lng, lat] — Amsterdam (public default; OPSEC-safe)
    zoom: 10,
    pitch: 0,
    bearing: 0,
    maxPitch: 80,
    attributionControl: false, // we add a compact one below
    dragRotate: true,
    cooperativeGestures: false,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  /**
   * Switch to a basemap category (imagery | topo), optionally selecting a
   * specific variant. If variantId is omitted, the current variant for that
   * category is kept (or the first variant if none was ever set).
   *
   * Returns { category, variantId } for the caller to reflect in UI.
   */
  function setBasemap(category, variantId) {
    if (!BASEMAPS.includes(category)) return { category: activeCategory, variantId: activeVariantIds[activeCategory] };

    const newVariant = variantId ?? activeVariantIds[category];

    // Hide every variant layer across all categories
    for (const cat of BASEMAPS) {
      for (const v of BASEMAP_VARIANTS[cat]) {
        const lid = variantLayerId(cat, v.id);
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', 'none');
      }
    }

    // Show only the target variant
    const targetId = variantLayerId(category, newVariant);
    if (map.getLayer(targetId)) map.setLayoutProperty(targetId, 'visibility', 'visible');

    activeCategory = category;
    activeVariantIds[category] = newVariant;
    return { category: activeCategory, variantId: newVariant };
  }

  // ---- 3D terrain --------------------------------------------------------
  let terrainOn = false;
  function setTerrain(on, { exaggeration = 1.5, pitch = 45 } = {}) {
    terrainOn = on;
    if (on) {
      map.setTerrain({ source: TERRARIUM_DEM.id, exaggeration });
      map.easeTo({ pitch, duration: 600 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
    return terrainOn;
  }

  // ---- 3D buildings (M10) ------------------------------------------------
  // Show/hide the OpenFreeMap extrusion layer. When shown, lift it to the top
  // so it sits above the coverage raster (z-order: basemap → coverage → buildings).
  function setBuildings(on) {
    if (!map.getLayer(BUILDINGS_LAYER)) return on;
    map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', on ? 'visible' : 'none');
    if (on) map.moveLayer(BUILDINGS_LAYER);
    return on;
  }

  // Combined 3D control: terrain relief + extruded buildings together.
  function set3D(on, opts) {
    setTerrain(on, opts);
    setBuildings(on);
    return on;
  }

  // ---- Day/night sky layer ------------------------------------------------
  // Adds or updates a MapLibre sky layer driven by the sun's azimuth + altitude.
  // altitudeDeg: degrees above (+) or below (−) the horizon; azimuthDeg: 0=N, CW.
  let skyLayerAdded = false;

  function ensureSkyLayer() {
    if (skyLayerAdded) return;
    if (!map.isStyleLoaded()) return; // caller checks before every call
    if (map.getLayer('sky')) { skyLayerAdded = true; return; }
    map.addLayer({
      id: 'sky',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [180, 45],
        'sky-atmosphere-sun-intensity': 5,
      },
    });
    skyLayerAdded = true;
  }

  function setSkyForSun(azimuthDeg, altitudeDeg) {
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => setSkyForSun(azimuthDeg, altitudeDeg));
      return;
    }
    ensureSkyLayer();
    if (!map.getLayer('sky')) return;
    map.setPaintProperty('sky', 'sky-atmosphere-sun', [azimuthDeg, altitudeDeg]);
    // Intensity: full sun in daylight, dim at civil twilight, 0 at night
    const intensity = altitudeDeg > 6 ? 10
      : altitudeDeg > -6 ? Math.max(0, (altitudeDeg + 6) / 12 * 10)
      : 0;
    map.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', intensity);
  }

  return {
    map,
    setBasemap,
    getBasemap: () => activeCategory,
    getVariant: (cat) => activeVariantIds[cat ?? activeCategory],
    setTerrain,
    toggleTerrain: (opts) => setTerrain(!terrainOn, opts),
    isTerrainOn: () => terrainOn,
    setBuildings,
    set3D,
    toggle3D: (opts) => set3D(!terrainOn, opts),
    is3DOn: () => terrainOn,
    setSkyForSun,
  };
}

/**
 * Keep the map sized correctly across panel/orientation/resize changes.
 */
export function keepMapSized(map) {
  const resize = () => map.resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  return resize;
}
