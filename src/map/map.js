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
    maxPitch: 85, // MapLibre max — lets the camera tilt to the horizon for max view distance
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

  // ---- Day/night sky (style-level, MapLibre v5) ----------------------------
  // MapLibre v5 removed the legacy 'sky' *layer* type; the sky is a style
  // property now (map.setSky) with sky/horizon/fog colours + blend factors.
  // It has no sun-position input, so the sun's altitude drives the
  // skyColoursFor() ramp instead (azimuth still steers the hillshade
  // illumination separately). altitudeDeg: degrees above (+) / below (−)
  // the horizon.

  function setSkyForSun(azimuthDeg, altitudeDeg) {
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => setSkyForSun(azimuthDeg, altitudeDeg));
      return;
    }
    const c = skyColoursFor(altitudeDeg);
    map.setSky({
      'sky-color': c.sky,
      'horizon-color': c.horizon,
      'fog-color': c.fog,
      'fog-ground-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'sky-horizon-blend': 0.8,
      // Sky only matters tilted at the horizon — fade it out when zoomed in flat.
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
    });
  }

  // ---- Hillshade sun direction -------------------------------------------
  // Point every hillshade layer's illumination at the sun's compass azimuth so
  // terrain relief is lit consistently with the day/night sky. Anchor 'map'
  // makes the direction compass-absolute (0 = north) rather than viewport-
  // relative, so it stays correct as the map rotates.
  function setHillshadeDirection(azimuthDeg) {
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => setHillshadeDirection(azimuthDeg));
      return;
    }
    const dir = ((Math.round(azimuthDeg) % 360) + 360) % 360; // 0–359
    const layers = map.getStyle().layers.filter((l) => l.type === 'hillshade');
    for (const l of layers) {
      map.setPaintProperty(l.id, 'hillshade-illumination-direction', dir);
      map.setPaintProperty(l.id, 'hillshade-illumination-anchor', 'map');
    }
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
    setHillshadeDirection,
  };
}

// ---- Day/night sky colour ramp (pure, unit-tested) -------------------------
// Colour stops by sun altitude: night → twilight → horizon → day. The night
// stop matches the dark map canvas (--mapbg) so the horizon stays seamless.
// These are physical sky colours on the always-dark map canvas, like the
// coverage spectrum — not theme colours.
const SKY_STOPS = [
  [-12, { sky: '#0b1018', horizon: '#101725', fog: '#0b1018' }], // night
  [-6, { sky: '#101c30', horizon: '#3a2f3a', fog: '#141a26' }], // astronomical → civil twilight
  [0, { sky: '#274b73', horizon: '#c97b4f', fog: '#3a4a5f' }], // sun on the horizon
  [6, { sky: '#5d92c4', horizon: '#e8c9a0', fog: '#aabfd3' }], // golden hour
  [20, { sky: '#7fb8e6', horizon: '#dfeefc', fog: '#cfe2f0' }], // full day
];

const hexToRgbSky = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function mixHex(a, b, f) {
  const ca = hexToRgbSky(a);
  const cb = hexToRgbSky(b);
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

/** Interpolate { sky, horizon, fog } hex colours for a sun altitude (deg). */
export function skyColoursFor(altitudeDeg) {
  const alt = Math.max(SKY_STOPS[0][0], Math.min(SKY_STOPS[SKY_STOPS.length - 1][0], altitudeDeg));
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const [a0, c0] = SKY_STOPS[i - 1];
    const [a1, c1] = SKY_STOPS[i];
    if (alt <= a1) {
      const f = (alt - a0) / (a1 - a0);
      return {
        sky: mixHex(c0.sky, c1.sky, f),
        horizon: mixHex(c0.horizon, c1.horizon, f),
        fog: mixHex(c0.fog, c1.fog, f),
      };
    }
  }
  return { ...SKY_STOPS[SKY_STOPS.length - 1][1] };
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
