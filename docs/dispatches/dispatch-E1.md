# Dispatch — GroundLink E1 (PMTiles + COG no-key data layer)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds E1, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/E1-pmtiles-cog-data.md`** — a no-key, OPSEC-clean, offline-ready data
  layer: **PMTiles** map sources (vector/raster/raster-dem) + **Cloud-Optimized
  GeoTIFF** sampling via **geotiff.js**, behind stable `ElevationSource` /
  `ClutterSource` interfaces, plus an explicit "Prepare this area for offline"
  packaging step into OPFS. This is the substrate M31 (clutter datasets) and the
  parked offline/edge phase build on, and the clutter feed E2 (P.1812) consumes.

Survey before coding: the **existing AWS Terrarium elevation reader** (wrap it as
the first `ElevationSource` with no behaviour change — find it via the coverage
worker's terrain sampling in `src/workers/coverage.worker.js`), `src/map/`
(MapLibre setup + the M9 live-Overpass building path + M10 fill-extrusion you can
swap to a static PMTiles source), the layers panel, and `src/coverage/model.js`
(the sampler consumers).

## Hard constraints (non-negotiable)

- **Only two new deps:** `pmtiles` and `geotiff` (both MIT). No others. Justify
  them in `CLAUDE.md` per the dependency-light rule.
- **No keys, no accounts.** Runtime network = **public no-sign-request** static
  byte-range reads only (Copernicus DEM on AWS, ETH/Meta canopy COGs, Overture/
  MS building PMTiles). **Verify CORS per source**; any source without CORS is
  **offline-staging-only** (packaging script, never runtime). OpenTopography
  (key) and live Overpass are staging-only by rule.
- **OPSEC.** Packaged AOIs reveal the user's area — they live in **OPFS, local,
  never uploaded**. No coordinates in tests. Packaging is an explicit user
  action, never automatic.
- **Graceful degradation.** A failing/CORS-blocked source logs once, the sampler
  returns the neutral value (clutter 0 / Terrarium elevation), and the plot
  still renders with a clear notice — never a hard failure.
- **No colour/token changes.** Both themes.
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # clean tree
git checkout main && git pull
git checkout -b feat/e1-pmtiles-cog
npm i pmtiles geotiff            # the only adds; justify in CLAUDE.md
```

## Step 1 — Tests first (TDD): interfaces + COG math

- `src/data/sources.test.js` — the Terrarium wrapper returns identical
  elevations through the new `ElevationSource` (regression); a fake
  `ClutterSource` returns 0 off-extent; the sampler LRU returns cached values
  without refetch (spy).
- `src/data/cog.test.js` — overview/byte-window selection for a given
  lng/lat/zoom against fixtures; 404/CORS path yields neutral value + single
  notice, not a throw.
- `src/data/offline.test.js` — manifest round-trip (extent/datasets/zooms);
  sampler prefers OPFS when a packaged AOI covers the point.

## Step 2 — Source interfaces (`src/data/sources.js`)

Spec §A. Define `ElevationSource.sampleM(lng,lat)` and
`ClutterSource.heightM(lng,lat)`. Wrap the existing Terrarium reader as the first
`ElevationSource` (no behaviour change). Add `CogElevationSource` (Copernicus
GLO-30) and `CogClutterSource` (ETH/Meta canopy) behind the same interfaces.
Engines receive sources via the worker message — never the concrete type.

## Step 3 — COG reading (`src/data/cog.js`)

Spec §B. geotiff.js opens a COG and reads only the needed overview/byte-range;
LRU tile cache keyed by (source id, tile), running in the worker. Graceful
degradation as above.

## Step 4 — PMTiles map layers (`src/map/pmtiles.js`)

Spec §C. Register the PMTiles protocol once at startup. Add an optional building
(Overture/MS subset, vector) source feeding the M10 fill-extrusion as a static
OPSEC-clean alternative to live Overpass, and optional landcover/canopy raster
overlays in the layers panel. Propagation numbers stay from the COG sampler
(one source of truth).

## Step 5 — Offline AOI packaging (`src/data/offline.js`)

Spec §D. "Prepare this area for offline" fetches the AOI's DEM/canopy/landcover
tiles and writes one PMTiles into OPFS; a manifest records extent/datasets/zooms;
samplers prefer OPFS when present. Behind an explicit button; document the OPFS
storage budget.

## Step 6 — Verify in the browser (manual checklist)

`npm run dev`, both themes. A COG-backed coverage run vs Terrarium-only shows the
expected clutter differences; toggle the PMTiles building/landcover layers; run
"Prepare this area for offline", then reload with the network throttled/blocked
and confirm terrain + coverage still render for that AOI; kill a source URL and
confirm graceful degradation + notice.

## Step 7 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "E1: PMTiles + COG no-key data layer with offline AOI packaging"
git push -u origin feat/e1-pmtiles-cog
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` (deps justified; Status; "Open / later": clutter datasets M31 can now
wire onto these interfaces, offline/edge groundwork laid) and record the
CORS-per-source findings in `docs/decisions/`. Roadmap reference:
`../../roadmap-2026H2.md`.
