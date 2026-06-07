/**
 * MapLibre style + basemaps.
 *
 * One style holds every raster basemap (and every topo/imagery variant) as
 * separate hidden layers; switching is a visibility toggle so runtime-added
 * layers (AOI, coverage) survive — unlike setStyle which would wipe them.
 *
 * "Dark" is removed: the canvas background is always the dark mapbg token
 * (sufficient for operations use). Two primary modes remain:
 *   imagery — Esri satellite (default)
 *   topo    — multiple variants, chosen via dropdown
 *
 * The category is chosen explicitly by the user (chips); there is no
 * zoom-based auto-switching. All sources are token-free.
 */

export const BASEMAPS = ['imagery', 'topo'];
export const DEFAULT_BASEMAP = 'imagery';

/**
 * Variants for each basemap category. The first entry in each array is the
 * default. All are free and token-free (Esri AGOL open tiles, OpenTopoMap,
 * OSM, CARTO). Add more later — only visible layers load tiles.
 */
export const BASEMAP_VARIANTS = {
  imagery: [
    {
      id: 'esri-imagery',
      label: 'Esri Satellite',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution:
        'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
    {
      // EOX Sentinel-2 cloudless 2024 — free, no token, global coverage.
      // WMS source: uses {bbox-epsg-3857} which MapLibre replaces with tile bounds.
      // License: CC BY-NC-SA 4.0 (non-commercial). 10 m resolution.
      //
      // NB: the layer MUST be the Mercator-native `s2cloudless-2024_3857`.
      // The plain `s2cloudless-2024` layer advertises only EPSG:4326 in the
      // WMS GetCapabilities, so requesting it with srs=EPSG:3857 returns
      // HTTP 400 for every tile. `_3857` supports EPSG:3857 / EPSG:900913.
      id: 's2cloudless-2024',
      label: 'Sentinel-2 2024 (climate)',
      wms: true, // flag: tile URL uses {bbox-epsg-3857} instead of {x}/{y}/{z}
      tiles: [
        'https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1' +
          '&layers=s2cloudless-2024_3857&styles=&format=image%2Fjpeg' +
          '&width=256&height=256&srs=EPSG%3A3857&bbox={bbox-epsg-3857}',
      ],
      attribution:
        'Imagery &copy; <a href="https://s2maps.eu">EOX</a> / ' +
        '<a href="https://www.esa.int/">ESA</a> Sentinel-2 2024 (CC BY-NC-SA)',
      maxzoom: 15,
    },
  ],
  topo: [
    {
      id: 'opentopomap',
      label: 'OpenTopoMap',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxzoom: 17,
    },
    {
      id: 'esri-topo',
      label: 'Esri World Topo',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution: 'Map data &copy; <a href="https://www.esri.com/">Esri</a>',
      maxzoom: 19,
    },
    {
      id: 'esri-street',
      label: 'Esri Street Map',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution: 'Map data &copy; <a href="https://www.esri.com/">Esri</a>',
      maxzoom: 19,
    },
    {
      id: 'osm',
      label: 'OpenStreetMap',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
    {
      id: 'carto-voyager',
      label: 'Carto Voyager',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      ],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 19,
    },
    {
      id: 'esri-natgeo',
      label: 'Esri National Geographic',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution:
        'Map data &copy; <a href="https://www.esri.com/">Esri</a> &amp; National Geographic',
      maxzoom: 16,
    },
  ],
};

/** Map-layer ID for a given category + variant. */
export function variantLayerId(category, variantId) {
  return `base-${category}-${variantId}`;
}

// AWS Terrarium DEM — free, token-free; encoding 'terrarium'.
export const TERRARIUM_DEM = {
  id: 'dem',
  spec: {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
    attribution:
      'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles (AWS)</a>',
  },
};

const MAP_BG = '#0b1018'; // --mapbg, dark in both themes

/**
 * Build the full MapLibre style. All variant layers are declared up-front;
 * only the active one is visible (MapLibre doesn't fetch tiles for hidden layers).
 *
 * @param {string} activeCategory  'imagery' | 'topo'
 * @param {Object} activeVariantIds  { imagery: 'esri-imagery', topo: 'opentopomap' }
 */
export function buildStyle(
  activeCategory = DEFAULT_BASEMAP,
  activeVariantIds = {},
) {
  const sources = {};
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': MAP_BG } }];

  for (const category of BASEMAPS) {
    const variants = BASEMAP_VARIANTS[category];
    const activeVariantId = activeVariantIds[category] ?? variants[0].id;

    for (const v of variants) {
      const layerId = variantLayerId(category, v.id);
      sources[layerId] = {
        type: 'raster',
        tiles: v.tiles,
        tileSize: 256,
        maxzoom: v.maxzoom,
        attribution: v.attribution,
      };
      layers.push({
        id: layerId,
        type: 'raster',
        source: layerId,
        layout: {
          visibility:
            category === activeCategory && v.id === activeVariantId ? 'visible' : 'none',
        },
      });
    }
  }

  // DEM source is declared up-front so setTerrain can reference it on demand.
  sources[TERRARIUM_DEM.id] = TERRARIUM_DEM.spec;

  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources,
    layers,
  };
}
