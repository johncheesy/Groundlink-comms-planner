/**
 * MapLibre style + basemaps.
 *
 * One style holds every raster basemap as a separate source/layer; we switch by
 * toggling layer visibility (so runtime-added layers — AOI, coverage — survive,
 * unlike setStyle which would wipe them). A dark background layer keeps the map
 * canvas dark in both UI themes, even before tiles load.
 *
 * All sources are token-free. A raster-dem source (AWS Terrarium) backs 3D
 * terrain and the coverage elevation sampler without a Mapbox token; Mapbox
 * Terrain-RGB can be swapped in at runtime when the user supplies a token.
 */

export const BASEMAPS = ['dark', 'imagery', 'topo'];
export const DEFAULT_BASEMAP = 'dark';

export const RASTER_BASEMAPS = {
  dark: {
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png',
      'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png',
    ],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxzoom: 20,
  },
  imagery: {
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  topo: {
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxzoom: 17,
  },
};

// AWS Terrarium DEM — free, token-free; encoding 'terrarium'.
export const TERRARIUM_DEM = {
  id: 'dem',
  spec: {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
    attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles (AWS)</a>',
  },
};

const MAP_BG = '#0b1018'; // --mapbg, dark in both themes

export function buildStyle(active = DEFAULT_BASEMAP) {
  const sources = {};
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': MAP_BG } }];

  for (const name of BASEMAPS) {
    const b = RASTER_BASEMAPS[name];
    sources[`base-${name}`] = {
      type: 'raster',
      tiles: b.tiles,
      tileSize: 256,
      maxzoom: b.maxzoom,
      attribution: b.attribution,
    };
    layers.push({
      id: `base-${name}`,
      type: 'raster',
      source: `base-${name}`,
      layout: { visibility: name === active ? 'visible' : 'none' },
    });
  }

  // DEM source is declared up-front so setTerrain can reference it on demand.
  sources[TERRARIUM_DEM.id] = TERRARIUM_DEM.spec;

  return {
    version: 8,
    // MapLibre needs a glyphs URL if any symbol layers use text; we use none,
    // but provide one so future text layers don't error.
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources,
    layers,
  };
}
