# 0001 — Map library: Leaflet (for now)

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
