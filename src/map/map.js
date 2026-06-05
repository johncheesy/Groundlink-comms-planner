import L from 'leaflet';
import { createBasemaps, DEFAULT_BASEMAP } from './basemaps.js';

/**
 * Initialise the Leaflet map inside #map.
 *
 * The container background is the dark --mapbg token (set in CSS) so the canvas
 * reads dark in both light and dark UI themes, and stays dark while tiles load.
 * We disable Leaflet's default zoom control and drive zoom from our own toolbar.
 */
export function initMap(container) {
  const map = L.map(container, {
    center: [-1.95, 30.06], // neutral start: central/east Africa region
    zoom: 8,
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
  });

  const basemaps = createBasemaps();
  let activeBasemap = DEFAULT_BASEMAP;
  basemaps[activeBasemap].addTo(map);

  function setBasemap(name) {
    if (!basemaps[name] || name === activeBasemap) return activeBasemap;
    map.removeLayer(basemaps[activeBasemap]);
    basemaps[name].addTo(map);
    // keep the basemap below overlays (AOI etc.)
    basemaps[name].bringToBack();
    activeBasemap = name;
    return activeBasemap;
  }

  return { map, basemaps, setBasemap, getBasemap: () => activeBasemap };
}

/**
 * Keep the map sized correctly across panel/orientation/resize changes.
 * Leaflet needs invalidateSize() whenever its container box changes.
 */
export function keepMapSized(map) {
  const invalidate = () => map.invalidateSize({ animate: false });
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  return invalidate;
}
