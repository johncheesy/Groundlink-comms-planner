# 0001 — Map library: Leaflet → MapLibre GL JS

**Status:** SUPERSEDED — migrated to MapLibre GL JS at M2 (per CLAUDE.md v2.1)
**Date:** 2026-06-05 (M1) · migrated 2026-06-06 (M2)

## Update (2026-06-06) — migrated to MapLibre GL JS

Leaflet was replaced by **MapLibre GL JS 5.x** to get native 3D terrain
(raster-DEM + pitch/tilt) and a path to vector basemaps, as mandated by
CLAUDE.md v2.1 and needed for M2/M2.1. Notes:

- Basemaps are raster sources in one style, toggled by layer visibility (so
  runtime AOI/coverage layers survive — `setStyle` would wipe them).
- DEM is **AWS Terrarium** (token-free) for both 3D terrain and the coverage
  elevation sampler; Mapbox Terrain-RGB can be swapped in at runtime with a
  user-supplied token (OPSEC: never committed).
- AOI draw uses GeoJSON sources/layers + draggable marker handles (still no
  external draw plugin). Coverage is an `image` source + raster layer.
- Map canvas stays dark via a background layer (#0b1018) + dark default basemap.

The original M1 rationale below is kept for history.

---

# (history) 0001 — Map library: Leaflet (for M1)

**Status:** accepted (M1) · revisit at M2 (terrain) / vector basemaps
**Date:** 2026-06-05

## Context

M1 needs a slippy map with raster basemaps, our own zoom/tool controls, a dark
canvas in both themes, and AOI drawing (radius + polygon). The single-file
prototype used Leaflet. CLAUDE.md lists Leaflet first, MapLibre GL as the
alternative for vector basemaps.

## Decision

Use **Leaflet 1.9** for M1.

- Lighter and simpler for raster basemaps + custom-styled vector overlays
  (circles, polygons, markers) — exactly the M1 surface.
- Matches the prototype, so proven behaviour ports directly.
- AOI draw is built on Leaflet primitives (`L.circle`, `L.polygon`,
  `L.polyline`, `divIcon` vertex handles) — no `leaflet-draw` dependency, so we
  keep full control of styling against the design tokens.

## Consequences / revisit triggers

- **Terrain (M2):** coverage rasters overlay fine on Leaflet (image/canvas
  overlays). No blocker.
- **Vector basemaps / 3D / tilt:** if we want vector tiles, terrain hillshade as
  a basemap, or 3D, reconsider **MapLibre GL**. The map module
  (`src/map/map.js`, `basemaps.js`) is deliberately thin to make that swap
  contained.

## Alternatives considered

- **MapLibre GL** — better for vector basemaps, GPU rendering, 3D/tilt; heavier
  and more setup than M1 needs. Strong candidate for a later milestone.
