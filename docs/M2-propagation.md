# M2 — Propagation engine

Specification for Milestone 2 (terrain-aware coverage). Distilled from the engine research. Read together with `../CLAUDE.md` and `design-tokens.md`.

## Goal

Turn a mission (area / sites / route / points) + the imported radios into a terrain-aware **coverage raster**, received-signal classes, and the inputs for site recommendation — running web-first, client-side, and offline-capable.

## Model decision

- **Core model: Longley-Rice / ITM** (Irregular Terrain Model). The de-facto standard; covers ~40 MHz–100 GHz, so VHF / UHF / LoRa (433/868/915) / satcom line-of-sight. Knife-edge diffraction included.
- **Fallback: FSPL + single knife-edge (Deygout) + clutter margin, k = 4/3 earth.** Instant, zero-data; what the prototype already does. Always available so a plot appears immediately.
- **HF is out of scope for ITM** (Barrett 1.6–30 MHz / NVIS). Treat HF as a **separate ionospheric/ground-wave module later** (ITU-R P.533 / VOACAP-style). Do not run HF through ITM.
- **Optional later: ITU-R P.1812** (30 MHz–6 GHz, point-to-area, physically based, clutter built into the model). Reference code exists (official MATLAB/Octave; Python `Py1812`). Consider as a high-accuracy mode / backend in Phase B.

## Implementation — phased

**Phase A (this milestone) — client-side WASM.**

- Compile ITM to **WebAssembly** and run it in a **Web Worker** (keep the UI responsive).
- Preferred source: the **NTIA/ITS ITM reference (C++)** — US-government work, public domain → clean for a commercial product, no GPL.
- Alternative: the existing **Rust port** of the CloudRF/Signal-Server algorithms (ITM3, Hata+COST123, FSPL, Fresnel, SRTM `.hgt` reader) → compiles to WASM cleanly. **Check its licence** before shipping (Signal-Server lineage is GPL).
- Keep FSPL+Deygout as the fallback path.
- Rationale: stays **static (GitHub Pages), private (data never leaves the browser — OPSEC), and offline-ready**.

**Phase B (later) — optional backend / edge.**

- `signal-server` (C++, ITM + ~10 models, SRTM/LiDAR, user clutter `.udt`) or a `P.1812` service for heavy areas, batch, 3D, and an offline-edge appliance.
- GPL note: running it as a **network service** is generally fine without releasing app source; **distributing the binary** triggers GPL. Get a licence review before any commercial distribution.

## Data stack

**Terrain (DEM)**

- **Now:** Mapbox Terrain-RGB tiles (already wired; browser-native elevation).
- **Best free global:** Copernicus **GLO-30** (~30 m, most accurate free global DEM; via AWS / OpenTopography / Earth Engine). Note: it is a **DSM** (includes buildings + vegetation).
- **SRTM 30/90 m:** native input format for `signal-server` (HGT → SDF).
- ⚠️ **DSM vs DTM double-count:** if you use a DSM (GLO-30) *and* add canopy/clutter height, you double-count vegetation. Choose one: (a) bare-earth **DTM + explicit clutter heights**, or (b) **DSM directly + attenuation-only margins** per land class. Decide and document.

**Clutter (land cover)**

- **ESA WorldCover 10 m** (2020/2021), 11 classes (tree cover, shrubland, grassland, cropland, built-up, bare, water, wetland, mangrove, moss, snow). **CC-BY-4.0**, free; Sentinel-1/2; ~76.7% accuracy. **Africa copy via Digital Earth Africa.**
- Map each class → a **clutter height + extra attenuation** (or use `signal-server` Urban/Suburban/Rural modes). P.1812 has clutter built in if used later.

**Canopy height (clutter refinement)**

- **ETH Global Canopy Height 2020, 10 m** (GEDI + Sentinel-2, CC-BY) — actual tree heights for tree-cover pixels.
- Or **Meta/WRI Global Canopy Height, 1 m** (AWS Open Data) for fine detail near sites/routes.

**Buildings & 3D fidelity**

- **Now (coarse / implicit):** the DSM (GLO-30) already includes buildings, but at ~30 m they are smoothed into bulk surface — not individual structures. WorldCover's **Built-up** class adds area-averaged urban clutter loss (and P.1812 adds building-entry loss if used). So "urban areas attenuate more" is handled statistically; discrete buildings are **not**.
- **Later (high-fidelity, Phase B):** discrete building footprints + heights for per-building blocking/diffraction and indoor (building-entry) loss. True 3D ray-trace is the heaviest tier (CloudRF-style / LiDAR / BYO).
- **3D view vs 3D modeling:** a 3D map *view* (tilt + terrain relief + extruded buildings + coverage draped on terrain) is **visualization** and can ship early — terrain + drape first, building extrusion when footprint/height data lands. 3D *propagation* (ray-trace through buildings) is the heavy **Phase-B** tier. The 3D view needs a 3D-capable map engine (**MapLibre GL**), not Leaflet.
- **Footprint datasets (free):** **Google Open Buildings v3** (~1.8 B buildings, Africa + Global South — directly relevant to our regions), **Microsoft Global ML Building Footprints** (~1.4 B, near-global, ODbL), or the conflated **Google-Microsoft / Overture** sets in cloud-native formats (PMTiles / GeoParquet) that tile easily into the app.
- **Heights are the gap:** footprints are easy globally; per-building heights are patchy outside the US/Europe. Sources: Open Buildings **2.5D** heights, Microsoft height estimates (EU/US), the **GHSL** building-height raster (~100 m mean net building height) as fallback, or estimate from storeys/class.
- **Licensing:** Google Open Buildings = CC-BY-4.0; Microsoft / Overture / OpenBuildingMap = ODbL (share-alike on derived data) — review before commercial distribution.
- **Use:** burn building heights into the surface model the engine samples (so diffraction sees them) and/or treat as discrete obstructions; add building-entry loss for indoor coverage.

## Compute & UX

- Tile the AOI; compute per-pixel path loss on a grid in the Web Worker; **chunk with a progress bar**.
- Default binding link = **talk-in** (handheld → repeater) unless the user changes it.
- Coverage classes by received dBm (editable presets per band): Excellent ≥ -85, Good ≥ -95, Marginal ≥ -103, None < -110. Colours per `design-tokens.md` (constant across jobs).

## Calibration & honesty

- Let the user **import field-measured RSSI** to tune clutter offsets (à la CloudRF "calibration").
- ITM/P.1812 give predictions per % time/location — surface that **reliability**, don't present a single hard number as ground truth. State that output is directional/planning-grade, not survey-grade.

## Pipeline (see M2-architecture diagram)

`Mission + radios` → `Terrain (DEM) + Clutter (land cover + canopy)` → `Engine (WASM ITM; fallback FSPL+Deygout)` → `Coverage raster + classes` → `Site recommendation, PACE/comms plan, export`. A calibration loop feeds measured RSSI back into the clutter model.

## Acceptance criteria (M2)

1. Coverage raster renders for an AOI using real terrain, aligned on the map.
1. ITM path runs in a Web Worker without freezing the UI; FSPL+Deygout fallback works with zero config.
1. Clutter from WorldCover measurably changes coverage vs. bare terrain.
1. Thresholds/bands editable; colours match the design tokens.
1. Graceful degradation + clear messaging when a data source is unavailable.

## Sources (identifiers)

ITM/Longley-Rice (NTIA/ITS reference; SPLAT!); `signal-server` (CloudRF lineage, GPL); Rust port `rf_signal_algorithms`; ITU-R P.1812-6/8 (+ `Py1812`); Copernicus GLO-30; SRTM; Mapbox Terrain-RGB; ESA WorldCover 10 m (+ Digital Earth Africa); ETH Global Canopy Height 2020 10 m; Meta/WRI Canopy Height 1 m. Buildings (later): Google Open Buildings v3, Microsoft Global ML Building Footprints, Overture, GHSL building height. HF later: ITU-R P.533 / VOACAP.
