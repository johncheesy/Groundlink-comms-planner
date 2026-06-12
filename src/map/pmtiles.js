/**
 * PMTiles map layers (E1 §C) — register the protocol once, plus the reference
 * vector layer: Overture/MS building footprints + heights from a single
 * static PMTiles archive on source.coop (CORS *, byte-range; verified
 * 12 Jun 2026 — table in docs/E1-pmtiles-cog-data.md). A 96 GB planet file
 * read a few kB at a time: no tile server, no key, OPSEC-clean static host.
 *
 * This is an alternative source for the existing M10 fill-extrusion view —
 * same muted building colour, sits above the coverage raster like the
 * OpenFreeMap layer it can stand in for.
 */

import maplibregl from 'maplibre-gl';
// pmtiles loads lazily on first use (buildings toggle / metadata discovery) —
// statically it pulled fflate into the main chunk for users who never enable
// the Overture layer.

export const OVERTURE_BUILDINGS_URL =
  'https://data.source.coop/cholmes/overture/overture-buildings.pmtiles';
export const OVERTURE_LAYER = 'buildings-pmtiles';
const OVERTURE_SRC = 'overture-buildings';
const BUILDING_COLOR = '#3b4250'; // same muted neutral as the M10 layer

let protocol = null;

/** Register the pmtiles:// protocol with MapLibre (idempotent, async). */
export async function registerPmtilesProtocol() {
  if (protocol) return protocol;
  const { Protocol } = await import('pmtiles');
  protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  return protocol;
}

/**
 * Discover the building source-layer name from the archive's own metadata
 * (tippecanoe `vector_layers`) instead of guessing — survives re-publishes.
 */
export async function discoverBuildingLayer(url = OVERTURE_BUILDINGS_URL) {
  const { PMTiles } = await import('pmtiles');
  const pm = new PMTiles(url);
  const meta = await pm.getMetadata();
  const layers = meta?.vector_layers ?? [];
  const byName = layers.find((l) => /building/i.test(l.id));
  return (byName ?? layers[0])?.id ?? null;
}

/**
 * Add (once) and toggle the Overture buildings extrusion. Lazy: the source is
 * only added on first show, so users who never enable it fetch nothing.
 * Returns true when visible, false when hidden/unavailable.
 */
export async function setOvertureBuildings(map, on, { url = OVERTURE_BUILDINGS_URL } = {}) {
  if (!on) {
    if (map.getLayer(OVERTURE_LAYER)) map.setLayoutProperty(OVERTURE_LAYER, 'visibility', 'none');
    return false;
  }
  try {
    if (!map.getSource(OVERTURE_SRC)) {
      await registerPmtilesProtocol();
      const sourceLayer = await discoverBuildingLayer(url);
      if (!sourceLayer) return false;
      map.addSource(OVERTURE_SRC, {
        type: 'vector',
        url: `pmtiles://${url}`,
        attribution:
          'Buildings: © <a href="https://overturemaps.org">Overture Maps Foundation</a>',
      });
      map.addLayer({
        id: OVERTURE_LAYER,
        type: 'fill-extrusion',
        source: OVERTURE_SRC,
        'source-layer': sourceLayer,
        minzoom: 14,
        paint: {
          'fill-extrusion-color': BUILDING_COLOR,
          // Overture carries height (m) where known; 5 m reads as "a building"
          // without inventing precision elsewhere.
          'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], 5],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
        },
      });
    } else {
      map.setLayoutProperty(OVERTURE_LAYER, 'visibility', 'visible');
    }
    map.moveLayer(OVERTURE_LAYER); // above the coverage raster, like M10
    return true;
  } catch (err) {
    console.warn('[groundlink] Overture PMTiles unavailable:', err?.message ?? err);
    return false;
  }
}
