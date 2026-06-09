# M10 — 3D view: terrain relief + building extrusion (authoritative spec)

Give the operational map a real **3D view** — terrain relief plus extruded
buildings — the open, no-key way. Photorealistic Google-Earth-style tiles are a
later, key-gated option (parked). Read alongside `CLAUDE.md`, `src/map/map.js`,
`../roadmap-next.md` (§6).

## Current state (build on, don't duplicate)

- **3D terrain already works.** `src/map/map.js` exposes `setTerrain(on, {
  exaggeration, pitch })`, `toggleTerrain`, `isTerrainOn`, draping the raster
  basemap over the **Terrarium DEM** (declared in `basemaps.js`). The map already
  has `dragRotate`, `maxPitch: 80`, pitch/bearing.
- **What's missing: buildings.** The app is **raster-basemap only**, so there is
  no building geometry to extrude. M10 adds a vector building source.

## Decision recap (from roadmap-next.md)

Free / no-key only → **MapLibre `fill-extrusion` of OSM buildings** + the existing
3D terrain. **Photorealistic Google 3D Tiles / Cesium are parked** (need a key /
billing) — capture as `docs/decisions/0004-3d-view.md`, don't build now.

## 1. Building source — OpenFreeMap (free, no key)

**OpenFreeMap** serves OpenStreetMap **vector** tiles with **no API key,
registration, or request limits**; its `building` layer carries `render_height`
and `render_min_height` — exactly what `fill-extrusion` needs. Self-hostable
later if desired.

- Add a vector source up-front in `buildStyle` (like the DEM is), e.g.
  `openfreemap` → `https://tiles.openfreemap.org/planet` (confirm the current tile
  JSON URL when wiring; OpenFreeMap publishes a styles/tiles endpoint).
- Add a hidden **`buildings-3d` `fill-extrusion`** layer (source-layer `building`):
  ```
  paint: {
    'fill-extrusion-color': <token, e.g. a muted surface>,
    'fill-extrusion-height': ['get', 'render_height'],
    'fill-extrusion-base': ['get', 'render_min_height'],
    'fill-extrusion-opacity': 0.85,
  }
  minzoom: 14   // extrusion only where it reads + stays performant
  ```
- Attribution: MapLibre adds OpenFreeMap/OSM automatically for the vector source.

## 2. Wire into the existing 3D toggle (`src/map/map.js`, `main.js`)

- Extend the 3D control so turning 3D on **(a)** enables terrain (already there)
  **and (b)** shows the `buildings-3d` layer; off hides both and resets pitch.
  Add `setBuildings(on)` + fold it into `setTerrain`/`toggleTerrain` (or a new
  `set3D(on)` that does both), keeping `isTerrainOn` semantics.
- Add a **building-height exaggeration**? No — keep true heights; only terrain has
  exaggeration. Optionally add a small pitch/compass reset + a "2D/3D" label.
- Keep the **map canvas dark** in both themes (design rule); buildings use a
  neutral surface token, not a bright fill.

## 3. Interplay with the coverage raster

- The coverage image layer drapes on terrain already. Ensure z-order: terrain →
  basemap → coverage raster → 3D buildings on top (buildings shouldn't be buried).
- Buildings are cosmetic/contextual in this milestone — they do **not** feed the
  propagation model (clutter/landcover stays the M2 roadmap item). Note this.

## 4. Photorealistic option (parked — `docs/decisions/0004-3d-view.md`)

Record, don't build: Google **Photorealistic 3D Tiles** (Map Tiles API, OGC 3D
Tiles via deck.gl `Tile3DLayer` / Cesium / MapLibre+three.js) gives Google-Earth
city meshes but needs a **Google Cloud billing account + key** (pay-as-you-go).
Cesium **OSM Buildings** is a richer keyed middle tier. Revisit if/when a key is
acceptable; the open extrusion path above ships now.

## Constraints

- **No key, no paid tiles** (OpenFreeMap is free + keyless).
- Extrusion only at `minzoom ≥ 14`; throttle so low-end devices stay smooth.
- No `localStorage` assumptions in embedded previews; the 3D toggle is in-memory.

## Acceptance

1. Toggle **3D** in a city (e.g. Amsterdam) → terrain relief **and** extruded
   buildings appear; pitch animates; OSM/OpenFreeMap attribution shows.
2. Toggle off → buildings hide, pitch/bearing reset to 2D; no key was used.
3. Coverage raster + 3D buildings render together with correct z-order.
4. Panning at z≥14 stays responsive; below z14 buildings are hidden.
5. `docs/decisions/0004-3d-view.md` records the parked photorealistic option.
