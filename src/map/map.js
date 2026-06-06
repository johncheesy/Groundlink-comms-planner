import maplibregl from 'maplibre-gl';
import { buildStyle, BASEMAPS, DEFAULT_BASEMAP, TERRARIUM_DEM } from './basemaps.js';

/**
 * Initialise the MapLibre GL map.
 *
 * The container background is the dark --mapbg token (CSS) and the style has a
 * dark background layer, so the canvas reads dark in both UI themes and while
 * tiles load. We disable the default controls and drive zoom/3D from our own
 * toolbar. Basemap switching toggles raster-layer visibility (runtime layers
 * such as AOI and coverage are preserved).
 */
export function initMap(container) {
  const map = new maplibregl.Map({
    container,
    style: buildStyle(DEFAULT_BASEMAP),
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

  let activeBasemap = DEFAULT_BASEMAP;
  function setBasemap(name) {
    if (!BASEMAPS.includes(name) || name === activeBasemap) return activeBasemap;
    map.setLayoutProperty(`base-${activeBasemap}`, 'visibility', 'none');
    map.setLayoutProperty(`base-${name}`, 'visibility', 'visible');
    activeBasemap = name;
    return activeBasemap;
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

  return {
    map,
    setBasemap,
    getBasemap: () => activeBasemap,
    setTerrain,
    toggleTerrain: (opts) => setTerrain(!terrainOn, opts),
    isTerrainOn: () => terrainOn,
  };
}

/**
 * Keep the map sized correctly across panel/orientation/resize changes.
 * MapLibre tracks window resize itself, but the mobile slide-over changes the
 * container box without a window resize — so call this then.
 */
export function keepMapSized(map) {
  const resize = () => map.resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  return resize;
}
