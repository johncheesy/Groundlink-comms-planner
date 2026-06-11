# M22 — Cellular layer fix + best-network indicator

## Why

The M9 cellular layer was reported broken after the M19/M20 workspace
restructure. Diagnosis (reproduced in the browser by forcing
`map.isStyleLoaded() === false` at click time):

- `ensureTowerLayer()` in `src/connectivity/cellular.js` bailed out with
  `if (!map.isStyleLoaded()) return;` and was **never retried**. MapLibre's
  `isStyleLoaded()` reports `false` whenever *any* tile is still in flight —
  not just before the style's `load` event. M19/M20 made those windows much
  longer and more frequent: panel collapse/expand, focus mode enter/exit and
  the right-rail flyouts all call `map.resize()`, which triggers tile
  refetches. A user who opened the Analysis group and clicked **Show
  coverage** while tiles were loading got the Overpass fetch, a readout
  claiming "N OSM towers in view" — and **no tower markers on the map**,
  silently, with no retry path. The per-type coverage rasters were unaffected
  (the coverage controller adds its sources without that gate), which made
  the failure look like "the cellular layer stopped working".

## Fix

`ensureTowerLayer()` no longer gates on `isStyleLoaded()`. It attempts
`addSource`/`addLayer` directly — MapLibre only throws before the style's
first `load` event, so the in-flight-tiles case now just works. If the add
genuinely throws (style not yet loaded), the latest tower FeatureCollection
is kept as pending state and flushed from a one-shot `map.once('load')`
retry. `updateTowerLayer()` always records the latest data, so nothing is
lost across the retry.

## Best-network indicator

Given the towers already fetched from Overpass (now keeping the OSM
`operator` tag), show which network likely has the strongest signal at the
probe point — the map centre by default, or a user-dropped pin.

### Model (pure, unit-tested)

`bestNetwork(towers, point)` in `src/connectivity/cellular.js`:

- Towers without an `operator` tag group under "Unknown operator".
- Score per tower = `distanceM / TYPE_WEIGHT[radio]`, lower is better —
  i.e. distance discounted by how capable the technology is:
  `NR 1.1 · LTE 1.0 · GSM 0.7 · UMTS 0.6` (per the requirement LTE > GSM >
  UMTS; NR slots above LTE). A GSM tower must be ~30 % closer than an LTE
  tower to win.
- Distance is `haversineM` from `src/coverage/model.js`.
- Returns `{ operator, radio, distanceM, ranking }` (ranking = best tower
  per operator, sorted by score) or `null` for an empty tower set.

This is a *proximity heuristic*, not a propagation result — honest label in
the UI help text. The terrain-aware story stays with the coverage rasters.

### UI

- New row in the cellular panel (`#cellPanel`): `Best signal:
  KPN (LTE, 340 m)` — tabular figures, design tokens only.
- Updates on map `moveend` (debounced via the event itself) while the
  cellular layer is enabled and towers are cached.
- **Pin** button arms a one-shot map click to drop a probe pin (teal dot,
  same marker pattern as the TX marker); while a pin is set the indicator is
  computed from the pin instead of the map centre. Clicking **Pin** again
  clears it.
- Row hides when the layer is off / cleared / no towers cached.
- The cellular section stays in the Analysis group (M20 nav) — no DOM moves.

### Out of scope

Operator-coloured tower markers, sector azimuths, RSRP estimates from the
coverage worker (the raster layer already covers signal-over-terrain).
