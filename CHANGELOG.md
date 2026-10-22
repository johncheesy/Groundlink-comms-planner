# Changelog

All notable changes to GroundLink are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **Real tree heights in clutter** (`src/data/canopy.js`, ADR 0008). Meta/WRI's canopy height map (~1.2 m, read at about 25–40 m) replaces the fixed 20 m per forest pixel: a young stand or open bush now blocks less than a tall forest, and tree lines in farmland count. Read from a CORS mirror on source.coop, the overview that fits the area, two requests per tile. Checked against land cover: Veluwe forest median 11–12 m and other classes 0 m, Amazon 20 m. Areas over about 150 km keep the class table. 15 tests.
- **Sharper LiDAR terrain for small areas.** With P.1812 and clutter on, small runs (zoom 13–14) use Mapterhorn's bare-earth LiDAR where every tile has it (about 35 countries); elsewhere, and for the FSPL+Deygout engine, terrain stays Copernicus GLO-30. The help text names the source.
- **Clutter now works worldwide** (`src/workers/worldcover.js`, review item F10). ESA WorldCover 2021 (10 m) is read from the Microsoft Planetary Computer data API: no key, CORS, one crop per 3° tile the area touches, and the grey value of each pixel is the land-cover class itself, so no colour matching. Measured in the app: Netherlands across a tile edge 0.65 s, Kenya 0.42 s, Alps 0.44 s. The Digital Earth Africa WMS stays as a fallback in Africa. The time-out is now 15 s instead of 4 s, and when clutter is missing the help text says why (time-out, unreachable, service error or unreadable data) instead of always blaming "Africa-only". 10 tests.
- **Finer coverage grid where it matters** (`src/coverage/grid.js`, review item F4). The cell size now follows the area of interest instead of the whole compute window, which reaches up to 3x beyond it. A 20 km-radius AOI went from about 545 m to 321 m per cell on Standard and 185 m on the new **High** detail setting (Coverage panel, remembered per browser). A cell budget keeps runs short (measured: 140k cells 1.2–1.9 s, P.1812 2.8 s; High 420k cells 3.5 s, P.1812 6.3 s) and shrinks with more than three transmitters, never below the old 220 x 220 grid, so multi-site runs are not slower than before (10 sites 3.8 s). The result card shows the cell size and suggests High when the grid is coarse. 11 tests.
- **Terrain from Copernicus GLO-30 (via Mapterhorn)** for coverage, path profile, drone envelope and offline packages, with a per-tile fallback to the previous AWS source. Newer and more accurate than SRTM: Matterhorn 4438 m (was 4274 m, true 4478 m), Dead Sea −432 m (was −412 m), Amsterdam 2 m (was 6.8 m). Capped at zoom 12 on purpose: above that the service has bare-earth LiDAR, which without a clutter layer would make coverage optimistic (ADR 0007). Tiles are decoded one by one so a 512 px tile next to a 256 px fallback tile never corrupts heights. The path profile now uses the same terrain at zoom 12 for short paths. The result card and help text name the terrain source. 12 tests.


### Added

**Interference map (M24 follow-up)** (`docs/M24-best-server.md`)
- Multi-site coverage gets a third view next to Quality and Best server: **Interference**, the carrier-to-interference ratio (C/I) with every site on one channel, summed over all other sites instead of only the runner-up. Five bands from ≥20 dB to below 0 dB in the coverage colours, and a line saying how much of the covered area is below 12 dB. The overlap margin on the zone map is now adjustable (1–20 dB). Both views are in the ⌘K palette. Checked in the app with three masts 10–15 km apart: 93% of the covered area below 12 dB C/I. 3 tests.

**M49 — Antenna model** (`docs/M49-antenna-model.md`)
- Coverage panel: transmit antenna preset (dipole, collinear, Yagi 3/5-element, sector 90°, panel 60°, custom) and pointing; in advanced mode gain, beamwidth, front-to-back and receive antenna gain. Directional antennas use the 3GPP parabolic horizontal pattern, so a Yagi pointing east now covers far to the east and little behind it (checked in the app: 4x the covered cells to the east of an omni at equal power). Applies to coverage, team coverage, calibration, path profile, mast wizard and CloudRF; site search keeps an omni. Saved in mission files and shown in the assumptions line. 15 tests.

**M48 — Live LEO/MEO pass window** (`docs/M48-leo-passes.md`)
- Satcom panel: per-constellation live line for Iridium, Globalstar and O3b — satellites above a 10° mask now, best elevation/azimuth, gaps and worst moment in the next 120 min, next pass when nothing is visible. SGP4 via `satellite.js` on CelesTrak element sets (CORS, no key, 6 h cache, stale-on-offline). Lazy-loaded chunk; eager bundle unchanged.
- Decision record `docs/decisions/0006-gods-eye-view-port.md`: what was and was not taken from God's Eye View 0.1.1.

### Changed
- CSP `connect-src` now allows `https://celestrak.org`.

### Added
- **Sharpest open aerial imagery, country by country.** No global open layer beats about 10 m (Sentinel-2), so national orthophoto programmes are drawn above the global layer inside their own bounds: Netherlands 8 cm, Switzerland 10 cm, NRW 10 to 20 cm, France 20 cm, Luxembourg 20 cm, Flanders 25 cm, Poland 25 cm, Austria 30 cm, Bavaria 40 cm, Spain 25 to 50 cm, USA about 1 m, Japan, New South Wales, Taiwan, Czechia, Saxony and Estonia. On by default, one switch in the basemap panel. Blank (white) and failed tiles become transparent so the base map shows through at borders and during outages, which also makes the seam between countries invisible. The credit lists only the providers in view. Sources and licences: `docs/DATA-SOURCES.md`. Code: `src/map/hires-imagery.js` (36 tests). The CSP and the service worker tile cache allow the new hosts.

### Changed
- **Esri imagery is no longer stored offline.** The service worker now sends Esri tile requests straight to the network (no cache, no stale copy) and deletes Esri tiles stored by earlier builds, because storing Esri imagery for offline use is a licensed use. Other providers keep their offline tile cache. The basemap panel states the terms for each imagery source, and `docs/DATA-SOURCES.md` has an "Intended use" section (research and other non-commercial use). Tested against the real worker in a sandbox (`src/test/sw.test.js`).

### Fixed
- **Black map when the satellite provider is unreachable.** If Esri (or any active basemap provider) is blocked, rate-limited or silent, the map now detects it from tile errors or tiles that never answer, switches to the next usable source (Sentinel-2, then a street map), and says so in a persistent notice with a "Try again" button. The failed provider is remembered for 30 minutes so a reload starts on the working source. Choosing a basemap yourself counts as a retry. Logic in `src/map/tile-health.js` (23 tests), wiring in `src/map/map.js`, notice in `src/ui/map-notice.js`.
- App start-up (AOI, mission tools, toolbar wiring) no longer waits for the first basemap tiles, only for the style, so a slow provider cannot leave the controls dead.
- **Readiness score** no longer reads 100 on an AOI alone. It needs at least 3 of 6 checks, says "based on n of 6", and deconfliction only counts with two or more radios.
- **Coverage result** now shows what it rests on (frequency, power, mast and receiver height, grid cell size, clutter, terrain) and warns when default radio values were used. The completion toast says so too.
- **Limits and validation** (`src/geo/validate.js`): 300 sites, 300 points, 2,000 route vertices, 80-character names; invalid or out-of-range coordinates are rejected everywhere. Promoting 50,000 imported points used to freeze the page for 32 s; marker redraw cost grows with the square of the count (500 sites 1 s). Bulk add keeps lines it could not add. Long GPS tracks are thinned, keeping both ends.
- **Mission files**: a missing coordinate is no longer silently moved to 0°N 0°E, an out-of-range one no longer throws halfway through loading, and everything skipped is reported.
- **Imports**: invalid geometry is dropped with a count instead of leaving the importer stuck on "Importing…".
- **Far-apart objects** (over 800 km) get a clear explanation in Coverage, Site recommendation and Offline package instead of an exception and a silent flat-earth fallback. The compute window is clamped to valid latitudes.
- **Radios**: "Save structure" no longer uses `window.prompt()` (it threw where prompts are blocked); the name is edited in place.

---

## [0.9.0-beta] — 2026-07-06

First public beta release. M1–M47 + E1–E4 feature-complete; BR1 security and
quality hardening applied. Domain-neutral (defence, conservation, humanitarian,
SAR, mining, expedition).

### Added

**M1–M10 — Core map and coverage**
- MapLibre GL JS shell with raster basemaps (Esri Imagery, PDOK, EOX Sentinel-2, OpenTopoMap, OpenFreeMap) and AWS Terrarium elevation (no token)
- FSPL + Deygout terrain-aware RF coverage raster
- 3D fill-extrusion view with MapLibre GL terrain
- Drone relay (M2.1): second coverage layer with AGL and battery model
- Site recommendation (M3): scored relay candidates from gap analysis
- Mission input modes (M4): AOI polygon / radius, fixed sites, route, points
- Radio import + mix (M5): FCC/ETSI lookup, custom entry, paired sets
- PACE + comms-plan report (M6): tiered primary/alternate/contingency/emergency plan
- Node roles + equipment table (M7)
- Power and endurance modelling incl. ATAK powerbank sizing (M8)
- Cellular connectivity overlay — live Overpass/OSM towers, no key (M9)

**M11–M18 — Extensions**
- Named waypoints (M11)
- HF/ionosphere path with VOACAP-style hop model (M12)
- Teams + Erlang-B talkgroup capacity (M13)
- Path profile, Fresnel zone, and per-link budget panel (M14)
- Digital-mode coverage: DMR, P25, dPMR (M15)
- Data export: GeoTIFF, KMZ, GeoJSON, CivTAK (M16)
- Offline PWA — service-worker caching, install prompt (M17)
- CloudRF ITM backend (user-entered key, sessionStorage only) (M18)

**M19–M23 — Workspace and UX**
- Workspace UX: top icon toolbar, left panel tabs, object registry, context menu, drag-to-move (M19)
- UX refinement: grouped toolbar stepper, ⌘K command palette, right map rail, result summary card, stale-plan pill (M20)
- Mission file save/load — local `*.groundlink.json`, ⌘S + drag-drop, focus mode, empty state, undo ⌘Z (M21)
- Cellular tower race fix + best-network indicator (M22)
- Service-worker update flow (build-stamped caches), palette Photon typeahead (M23)

**M27 — Field calibration**
- RSSI CSV import, deviation dot layer, per-radio bias offsets, undo/stale flow

**M35 — Mast-height wizard**
- Closed-form minimum clearing height per link, context-menu/⌘K entry, drone AGL variant

**M36–M43 — Operations intelligence**
- Mission ops dashboard — Maven-style fused RF+cellular+drone+PACE+teams panel (M36)
- Mission brief export — print-ready HTML, map image, PACE, link budgets, OPSEC footer (M37)
- Satellite comms overview — GEO look-angle protractor, LEO network badges (M38)
- Frequency deconfliction — co-channel, adjacent, protected-band checks (M39)
- Frequency plan export — printable A4 landscape table with PACE-tier colour coding (M40)
- Network topology diagram — SVG comms chain, hover interactions, SVG export (M41)
- Drone altitude optimizer — samples 6 AGL heights, bar-chart UI, auto-applies best (M42)
- Coverage gap report — dead-zone table export with relay recommendations (M43)

**M44–M47 — Finishing intelligence layer**
- Satcom fade margin UI — Ka/Ku rain-fade badges per GEO satellite (M44)
- Link-quality topology edges — FSPL margin-coded colours, dB hover tooltip (M45)
- Smart radio-to-node suggestion list — heuristic scoring, top-3 accordion, Apply button (M46)
- Mission readiness score — 0–100 gauge in ops dashboard, compact toolbar badge, 6-dimension breakdown (M47)

**E1–E4 — Engineering enhancements**
- PMTiles/COG no-key data layer — local-COG elevation/clutter, Overture buildings, OPFS offline packaging (E1)
- ITU-R P.1812-6 in-browser engine — pure-JS Delta-Bullington, propagation model selector with percentiles (E2)
- Model accuracy badges — per-model ±dB margin on result card (E3b)
- ITU-R P.618-14 satellite rain-fade engine (E4)

**BR1 — Beta readiness hardening (2026-07)**
- CSP meta header with explicit allowlist; inline frame-buster with SHA-256 hash
- `no-referrer` policy
- Removed maps.mail.ru from Overpass endpoint list (OPSEC)
- Unified escape helper (`src/util/esc.js`) — replaced 15 local `esc()` variants across 7 files
- Production build without sourcemaps (saves ~5 MB from deploy artifact)
- Dynamic `cog.js` import in `sources.js` — geotiff not parsed on worker startup unless a local COG file is loaded
- Error toasts for Overpass, cellular, and coverage worker failures
- README rewritten to match M47 reality (MapLibre, full feature table)
- `docs/INDEX.md` — milestone→spec→source cross-reference table
- `.mailmap` for canonical commit attribution

### Changed

- Propagation model: AWS Terrarium tiles (token-free) replace Mapbox Terrain-RGB
- Overpass endpoints: maps.mail.ru removed; 2-endpoint list (overpass-api.de + kumi.systems)

### Security

- CSP blocks `data:` worker sources, `object-src none`, `base-uri self`
- Frame-buster script with SHA-256 hash in CSP `script-src`
- All user-supplied strings escaped via `src/util/esc.js` before DOM insertion

---

## [0.1.0] — 2026-06-16

Initial internal release — M1 map shell through M23 UX refinement.

---

[0.9.0-beta]: https://github.com/johncheesy/Groundlink-comms-planner/compare/v0.1.0...v0.9.0-beta
[0.1.0]: https://github.com/johncheesy/Groundlink-comms-planner/releases/tag/v0.1.0
