# M51 — 3D masts on the map

**Status:** spec, 23 Oct 2026 · not started · follows M50 (per-site height)
and M49 (antenna pointing)

## Problem

The 3D view (terrain + globe, buildings from OpenFreeMap) shows the ground
in relief, but every site stays a flat pin on it. A 40 m repeater and a 6 m
relay look the same, and the one thing the planner is reasoning about in
3D — how high the antenna sits over the terrain around it — is invisible.
The drone relay has the same gap: it hovers at 50–120 m AGL but is drawn
as a pin on the ground.

M50 gave every site its own `txHeightM` and M49 its own `azimuthDeg`, so
the data to draw a mast at its real height already exists. Only the drawing
is missing.

## What it does (phase 1, this milestone)

Masts are built from MapLibre's own `fill-extrusion` layer type, the one the
buildings already use. No new dependency, no WebGL of our own.

### Shape

Each fixed site becomes three small polygons, drawn in one layer with
per-feature height and base:

| Part | Footprint | Base → top | Colour |
|---|---|---|---|
| Plinth | 12-gon, 2.5 m radius | 0 → 1 m | `--feat-site` at 55 % |
| Mast | 12-gon, 0.6 m radius | 0 → H | `--feat-site` |
| Head | 12-gon, 1.2 m radius | H − 1.5 m → H | `--feat-site`, lighter |

H is the site's own `txHeightM`, or the Coverage panel's mast height when
the site has none (the same fallback `siteTx()` uses for coverage).

A site with a **directional antenna** (panel antenna not omni, per
`isOmni()`) gets a fourth polygon: a 1.6 × 0.3 m rectangle at the top,
rotated to the site's pointing (`azimuthDeg`, or the panel's), in
`--feat-track` (azure: the beam wedge already belongs to the site, the
panel belongs to the antenna). It sits just below the head, H − 2 m → H − 0.5 m,
so the head does not hide it.

The **drone relay** (when placed) gets a hovering body: a 12-gon of 1.5 m
radius, base `altM − 1` → `altM`, in `--feat-track`, plus a 0.15 m-radius
tether polygon from 0 → `altM − 1` at 30 % opacity so the eye can find the
ground point. Recommended sites from M3 are not drawn: they are proposals,
and their markers already carry the number.

Footprints are computed in metres around the site and converted to degrees
with the local metres-per-degree (cos lat for longitude), so a mast is
round on the map at any latitude. A polygon with 12 sides is enough: at the
zooms where the masts read, each is a few pixels wide.

### When it shows

- Only while **3D terrain is on** (`toggle3dBtn`), via `visibility`. In the
  flat view the pins and labels do the job and an extrusion at pitch 0 is
  just a dot.
- `minzoom: 11`. Below that a 40 m mast is under a pixel tall and the layer
  only costs draw calls.
- Layer order: above the coverage raster and the buildings, below the
  labels (`raiseLabels()` keeps place names on top as today). The existing
  pins stay: they carry the name, the context menu and drag-to-move, and
  with pitch the pin anchors at the mast foot, which reads as "the pin
  marks the base".

### Updates

`updateMasts3d(map, sites, drone, { antenna, panelHeightM })` follows the
pattern of `updateAntennaBeams()` in `src/map/antenna-beams.js`: a pure
`mastFeatures()` builds the GeoJSON, the update function sets the source
data, creating source and layer on first call and deferring to the next
`idle` while the style is loading (the beam fix from `b38c30e` applies).
It is called from the same place `updateAntennaBeams()` is called in
`main.js` (sites changed, antenna changed) and additionally when the panel
mast height, the drone position or altitude, or the 3D toggle changes.

Moving a site (drag) updates on drop, like the beams, not every frame.

### Visual rules

- Colours come from the tokens only, read with `getComputedStyle` the way
  the beams do, and re-read on theme change. Teal = site, azure = drone and
  antenna, matching the rest of the map.
- `fill-extrusion-vertical-gradient: true` so the mast shades darker at the
  foot and reads as a solid.
- Opacity 0.95 for the mast and head, so a mast inside a coverage raster
  does not pick up the raster colour and look like a signal.
- No glow, no outline, no animation.

### Exports

- **KML/KMZ** (`src/export/kml.js`): the site placemark gets
  `<altitudeMode>relativeToGround</altitudeMode><extrude>1</extrude>` and a
  z of H in its coordinates, so Google Earth and ATAK draw a line from the
  ground to the antenna. The drone placemark gets `altM` the same way. No
  footprint polygons in KML: the extruded point is the standard way to show
  a mast there and reads better.
- GeoJSON already carries `txHeightM` as a property; nothing changes.

### Not in phase 1

- Guy wires, lattice, dishes, real shapes — phase 2.
- Masts for team members, waypoints or recommended sites.
- Picking the mast in 3D to open the site menu (the pin does that).
- Flat-view rendering of height (a label suffix already shows `25 m`).

## Phase 2 (later, separate milestone): glTF models

When the prisms are not enough, replace the drawing layer with real models
through MapLibre's `CustomLayerInterface` and three.js:

- Three or four small glTF files (monopole, lattice tower, tripod, vehicle
  mast), **licence-checked and listed in `docs/DATA-SOURCES.md`**, under
  100 kB each, in `public/models/`.
- A `MastModelLayer` custom layer that owns a three.js scene, one instance
  per site, scaled in Y to H with the top section kept rigid, rotated to
  `azimuthDeg`. The model type comes from the site (`mastType`, new
  optional field in the mission file; default by height: ≤ 8 m tripod,
  ≤ 30 m monopole, else lattice).
- three.js lazy-loaded only when 3D is turned on (same approach as the
  geotiff decoders), with a stub for the test runner like `web-worker`.
  Expect about 150 kB gzipped, which is why it is a later phase and needs
  its own justification line in `CLAUDE.md`.
- Known risks to check on a branch first: depth testing against the
  terrain mesh and globe projection in MapLibre 5 (custom layers render in
  mercator space; globe needs the v5 `renderingMode: '3d'` path and a
  projection matrix per frame), and picking (not needed if the pin keeps
  the menu).
- The phase-1 data hook (`mastFeatures()` and its call sites) stays; phase
  2 only swaps what consumes it.

## Tests

- `mastFeatures()`: one site without own height uses the panel height; with
  own height uses it; omni site has 3 features, directional 4; drone adds
  body + tether; the antenna rectangle is rotated to the azimuth (check the
  first vertex bearing); footprint radius in degrees scales with cos lat;
  empty input gives an empty collection.
- KML: a site with `txHeightM` emits `extrude` and `relativeToGround` with
  the right z; without a height it emits the panel height; the drone
  placemark emits `altM`.
- Manual: 3D on → masts appear at Utrecht test mission, heights differ per
  site; 3D off → gone; theme switch recolours; drag a site → mast follows.

## Files

- `src/map/masts-3d.js` (new, ~150 lines) and `masts-3d.test.js`
- `src/main.js`: import + calls next to `updateAntennaBeams()`, and in the
  3D toggle, drone and mast-height handlers
- `src/export/kml.js`: `placemark()` gains an `extrude` option; site and
  drone callers pass heights
- `CHANGELOG.md`, `docs/INDEX.md` row for M51
