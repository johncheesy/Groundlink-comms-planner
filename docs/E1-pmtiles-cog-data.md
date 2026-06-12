# E1 — PMTiles + COG data layer (no-key, offline-ready clutter/terrain)

> **Status: built (v1) — 12 Jun 2026.** Implementation notes + the CORS
> verification table at the bottom of this file; spec below kept as written.

Enabler milestone from the 12 Jun 2026 feature research
(`../../GroundLink_feature-onderzoek.docx`, `../../roadmap-2026H2.md` → M27+).
The data-delivery substrate that makes the free/no-key clutter and terrain
datasets (M31) consumable client-side, OPSEC-clean, and offline — and the
natural groundwork for the parked offline/edge phase.

**Why.** GroundLink's accuracy ceiling is set by missing clutter (vegetation +
buildings), and its offline story is unbuilt. The blocker for both is a
**data layer that needs no tile server and no key**: a way to read elevation,
canopy and building heights, and land cover directly in the browser from static
files, optionally pre-packaged for an AOI and stored locally. **PMTiles** (one
static file, HTTP byte-range, supports `vector` / `raster` / `raster-dem`) plus
**Cloud-Optimized GeoTIFF** read via **geotiff.js** (byte-range overviews) cover
every dataset in M31. Both are static-host friendly (GitHub Pages) and keep
every byte in the browser.

No colour/token changes. No keys, no accounts. The only network calls are
byte-range reads of **public, no-sign-request** static files (Copernicus DEM on
AWS, ETH/Meta canopy COGs, Overture/MS building PMTiles) — and even those become
optional once an AOI is packaged locally.

---

## Decisions to lock before build

1. **Dependencies.** Adding `pmtiles` (MapLibre protocol) and `geotiff` is
   justified — both are small, MIT, and there is no no-key alternative. Record
   the justification in `CLAUDE.md` (dependency-light rule). No other adds.
2. **Sampler interface, not a dataset commitment.** E1 ships the *plumbing* and
   one reference dataset per kind to prove it; M31 wires the full set. Define a
   stable **`ClutterSource` / `ElevationSource` interface** that E2's worker and
   the existing Terrarium sampler both implement, so engines depend on the
   interface, not the source.
3. **CORS reality.** Direct browser byte-range fetch of AWS COGs needs CORS
   headers on the bucket. **Verify per source** (Copernicus DEM and the canopy
   COGs publish CORS; confirm at build). Where a source lacks CORS, it is an
   **offline-staging-only** source: fetched by the packaging script, never at
   runtime. OpenTopography (API-key) and live Overpass are staging-only by rule.
4. **Packaging trigger.** AOI packaging (download → local PMTiles in OPFS) is an
   explicit user action ("Prepare this area for offline"), never automatic — it
   moves real bytes and must be deliberate. OPSEC: the packaged AOI reveals the
   user's area of interest, so it lives in OPFS (local), never uploaded.

---

## A. Source interfaces (`src/data/sources.js`, pure)

```js
// Elevation in metres at a coordinate; async, cached by tile.
export interface ElevationSource { sampleM(lng, lat): Promise<number>; id; }
// Representative clutter height (and optional class) at a coordinate.
export interface ClutterSource { heightM(lng, lat): Promise<number>; classOf?(lng,lat); id; }
```

- Wrap the **existing AWS Terrarium** elevation reader as the first
  `ElevationSource` (no behaviour change — just conform it to the interface).
- Add `CogElevationSource` (Copernicus GLO-30, no-sign-request) and
  `CogClutterSource` (ETH/Meta canopy COG) behind the same interfaces.
- Engines (E2 P.1812, the fallback worker) take these via the worker message —
  they never know which concrete source is behind them.

## B. COG reading (`src/data/cog.js`)

- Use **geotiff.js** to open a COG by URL and read only the byte-range/overview
  for the needed tile + zoom — minimal transfer, no server.
- A small LRU tile cache keyed by (source id, tile) so repeated pixel samples in
  the coverage grid don't refetch. Runs in the worker (shareable, off main
  thread).
- Graceful degradation: a source that 404s/CORS-fails logs once and the sampler
  returns the neutral value (clutter 0 / fall back to Terrarium elevation), with
  a clear in-app notice — never a hard failure of the plot.

## C. PMTiles map layers (`src/map/pmtiles.js`)

- Register the **PMTiles protocol** with MapLibre once at startup.
- Optional **building footprints + heights** as a `vector` PMTiles source
  (Overture/MS subset) feeding the existing M10 fill-extrusion — replacing/
  augmenting the live-Overpass path with a static, OPSEC-clean source.
- Optional **landcover / canopy** as `raster` PMTiles overlays in the layers
  panel (visual context; the propagation values still come from the COG sampler
  so numbers and pixels share one source of truth).

## D. Offline AOI packaging (`src/data/offline.js`)

- "Prepare this area for offline": for the current AOI, fetch the relevant
  DEM/canopy/landcover tiles and write a single **PMTiles file into OPFS**
  (`maplibre-offline-pmtiles`-style). Subsequent sessions read from OPFS — fully
  air-gapped, near-native performance.
- A manifest records which datasets/extent/zooms were packaged so the UI can
  show "this AOI is available offline" and the samplers prefer OPFS when present.
- This is the concrete first step of the parked **offline/edge** roadmap item;
  keep it behind an explicit button and document the OPFS storage budget.

---

## Tests (vitest, pure logic)

- `sources.test.js` — the Terrarium wrapper still returns identical elevations
  through the new interface (regression); a fake `ClutterSource` returns 0 off
  its data extent; sampler LRU returns cached values without refetch (spy).
- `cog.test.js` — tile/byte-range math (which overview + window for a given
  lng/lat/zoom) against known fixtures; 404/CORS path yields the neutral value +
  single notice, not a throw.
- `offline.test.js` — manifest round-trip (extent/datasets/zooms); sampler
  prefers OPFS when a packaged AOI covers the point.

Network reads, MapLibre rendering and OPFS verified manually in the browser
(standing rule): a COG-backed coverage run vs Terrarium-only shows the expected
clutter differences; "Prepare offline" then a reload with the network blocked
still renders terrain + coverage for that AOI.

## Constraints & non-goals

- Only `pmtiles` + `geotiff` added, both MIT, justified in `CLAUDE.md`.
- No keys, no accounts; runtime network limited to **public no-sign-request**
  static byte-range reads; staging-only sources (key/Overpass) never hit the
  runtime path. OPSEC: packaged AOIs stay in OPFS, never uploaded.
- No colour/token changes; both themes; layers panel additions reuse existing
  styles.
- Out of scope: the full M31 dataset matrix (E1 proves the interface with one
  source per kind), the P.1812 engine itself (E2 — it consumes these samplers),
  building **per-structure diffraction** (later; E1 just supplies heights).

## Acceptance checklist

- [x] Terrarium elevation works unchanged through the new sampler interface.
- [x] A COG-backed elevation/clutter sampler feeds the coverage worker
      (local-file path verified end-to-end in tests); failures degrade
      gracefully with a single console notice + in-app source naming.
- [x] PMTiles protocol registered; the Overture buildings PMTiles layer
      renders and toggles (Data flyout picks the source).
- [x] "Prepare this area" writes a PMTiles v3 to OPFS; coverage for that AOI
      computes offline (map terrain raster itself stays online — see notes).
- [x] CORS verified per runtime source (table below); no-CORS sources are
      local-file/staging-only as the spec rules.
- [x] `npm test` green; `npm run build` clean; both themes; deps justified in
      `CLAUDE.md`.

---

## Implementation notes (built 12 Jun 2026)

### CORS verification (decision 3) — probed 12 Jun 2026, `Origin: https://johncheesy.github.io`

| Source | Range | CORS | Runtime verdict |
| --- | --- | --- | --- |
| AWS Terrain Tiles (Terrarium PNG) | ✓ | ✓ | runtime (in use since M2) |
| Digital Earth Africa WMS (WorldCover) | n/a | ✓ | runtime (in use since M9, Africa) |
| **source.coop** Overture buildings PMTiles | ✓ | ✓ `*` | **runtime** — the E1 reference PMTiles layer |
| Copernicus GLO-30 COG (AWS) | ✓ | ✗ | local-file / staging only |
| ESA WorldCover COG (AWS) | ✓ | ✗ | local-file / staging only |
| Meta/WRI canopy CHM COG (AWS) | ✓ | ✗ | local-file / staging only |
| ETH canopy 10 m (share.phys.ethz.ch) | — | — | URL dead (301 → DOI); staging via new host only |

**Consequence:** no public global canopy/DEM **COG** currently ships CORS, so
the COG runtime entry is the **local file** (Data flyout → "Clutter/Elevation
COG"): the user stages the GeoTIFF once (download the tile for their area),
loads it from disk, and `geotiff.js` reads it in-browser — nothing is ever
uploaded, which also matches the standing OPSEC import pattern. Remote COG
URLs work too whenever a CORS-enabled host appears (the sampler accepts both).

### What shipped

- **`src/data/sources.js`** — the engine-facing seam. Elevation samplers
  (`{ id, sample }`) resolve local COG → OPFS offline package → network
  Terrarium; clutter samplers (`{ id, heightM, dbAt }`) resolve local COG →
  WorldCover WMS. P.1812 consumes `heightM`, the FSPL fallback consumes
  `dbAt` (`clutterDbForHeight`: log fit to the WorldCover class table) — one
  representation per engine, never both (decision 0005). Both workers
  (coverage, recommend) now build through this seam only.
- **`src/data/cog.js`** — geotiff.js wrapper: overview pick + window math as
  pure tested helpers, one window read per (source, level, window) behind an
  LRU, bilinear or nearest sampling, NaN/noData handling. Blob sources cache
  by object identity. Any failure logs once and returns null — the plot
  never hard-fails.
- **`src/data/offline.js`** — "Prepare this area" (Data flyout) fetches the
  Terrarium tiles for the coverage window (AOI ± the M2 `WINDOW_CAP_MULT`
  cap, zooms 8–12, ≤ 600 tiles) and writes a **PMTiles v3 archive + manifest
  into OPFS**. The writer is ~60 lines (Hilbert ids via the pmtiles lib,
  uncompressed internal directories, clustered) and is round-trip-tested
  against the reference `pmtiles` reader. Both workers prefer the package
  whenever its manifest covers the requested bounds — coverage computes
  fully offline; the status bar says `DEM (offline)`.
- **`src/map/pmtiles.js`** — protocol registration (idempotent, lazy) + the
  Overture buildings fill-extrusion, source-layer discovered from the
  archive's own metadata. The View-flyout Buildings toggle keeps working;
  the Data flyout picks OpenFreeMap (live tiles) vs Overture (static PMTiles).
- **Vite**: `worker.format = 'es'` (geotiff carries a nested decoder worker →
  worker bundles are multi-chunk now); the two PWA plugins are scoped to the
  app bundle (worker sub-builds fire `closeBundle` mid-build). geotiff's
  lerc/zstd decoders land in lazy chunks — fetched only if a COG uses them.

### Deliberate v1 scope (and why)

- **Offline packages the DEM only.** Clutter (WMS imagery) and basemap tiles
  are not packaged; the acceptance line "offline reload renders terrain +
  coverage" holds for the *coverage compute + its inputs*, while the map
  *canvas* under it still needs its basemap online. Packaging the visual
  layers is the parked offline/edge phase.
- **Raster PMTiles landcover overlay** (spec §C "optional") deferred to M31 —
  the protocol + vector reference layer prove the plumbing; the OPFS archive
  exercises the same reader.
- **No staging script yet**: the no-CORS sources are plain single-file
  downloads (1°/3° tiles); the Data flyout consumes them directly. A
  `scripts/fetch-aoi-cog.mjs` convenience wrapper can come with M31's
  dataset matrix.
- Engine/data-source choices are session-state, not yet in the mission file
  (same as the M18/E2 pattern).
