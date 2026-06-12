# Perf — main-bundle code splitting

*June 2026. Files: `src/data/cog.js`, `src/data/offline.js`, `src/data/tileid.js`
(new), `src/map/pmtiles.js`, `src/export/export-panel.js`, `src/main.js`.*

## Result

| chunk | before | after |
|---|---|---|
| main `index-*.js` | **401.1 kB** (gzip 135.9) | **299.8 kB** (gzip 102.3) |
| `coverage.worker-*.js` | 91.7 kB | 18.2 kB (+ shared lazy chunks) |
| maplibre (unchanged, pre-split) | 1 055 kB | 1 055 kB |

Target was < 300 kB. Everything below loads on first use, not at boot.

## What moved, and the mechanism for each

- **geotiff (+fflate decoders, ~316 kB chunk)** — `cog.js` now dynamic-imports
  `geotiff` on the first COG open. Only users who load a local COG (E1) pay
  for it; the coverage worker likewise only pulls its copy when a COG file is
  passed (Terrarium DEM sampling never touches geotiff).
- **pmtiles (+fflate, 18.8 kB chunk)** — the `PMTiles` reader and MapLibre
  `Protocol` are dynamic-imported in `map/pmtiles.js` (buildings toggle) and
  `offline.js` (OPFS package reads). `registerPmtilesProtocol()` became async;
  its only caller already was.
- **`src/data/tileid.js` (new)** — the offline writer (`writePmtiles`, sync,
  round-trip-tested) needs only `zxyToTileId`, but `pmtiles` ships as a single
  module without `sideEffects: false`, so *any* static import retained fflate.
  The ~30-line Hilbert codec is vendored (BSD-3 attribution in the header) and
  pinned by an equivalence test against the reference implementation across
  zooms/corners (`offline.test.js`).
- **export writers (geotiff/kml/geojson/tak/zip)** — `export-panel.js` loads
  them on the first export click.
- **PACE report writers (`pace/report.js`, 12.3 kB chunk)** — loaded on the
  Export-report click in `main.js`.
- **HF panel (`hf/hf-panel.js`, 6.4 kB chunk)** — the M12 init IIFE became
  async; `hfPanel` was already null-guarded everywhere.

## Verification

364 vitest green (incl. the new tileid equivalence test). Dist build booted
and the built coverage worker computed a Bardufoss terrain run through its
dynamic-import chunks (terrarium DEM + WorldCover clutter, all five signal
classes present).

## Note for local dist testing

The CSP (`connect-src https: data: blob:`) blocks same-origin fetches on
`http://localhost` — `vite preview` pages can't fetch `sw-assets.json` etc.
This is pre-existing and intentional for the https deploy; don't chase it as
a bundle/SW bug (we did).
