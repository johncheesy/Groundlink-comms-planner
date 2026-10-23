/**
 * MapLibre GL JS 6 runs tile parsing (vector tiles, GeoJSON, raster-dem
 * terrain) in a web worker that it looks for next to its own module file
 * (`./maplibre-gl-worker.mjs`). Once Vite bundles the library into
 * `assets/maplibre-*.js` that file does not exist, the worker fails to load,
 * and every worker-backed layer silently draws nothing: imported files, the
 * mission's GeoJSON layers, 3D buildings and terrain height (0.10.0-beta).
 *
 * `?worker&url` makes Vite bundle the worker (it imports a shared chunk) into
 * one ES module and hands back its URL; setWorkerUrl() points MapLibre at it.
 * Imported for its side effect before the first map is created.
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

export { workerUrl };
