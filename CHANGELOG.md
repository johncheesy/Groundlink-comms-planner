# Changelog

All notable changes to GroundLink are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

**M48 — Live LEO/MEO pass window** (`docs/M48-leo-passes.md`)
- Satcom panel: per-constellation live line for Iridium, Globalstar and O3b — satellites above a 10° mask now, best elevation/azimuth, gaps and worst moment in the next 120 min, next pass when nothing is visible. SGP4 via `satellite.js` on CelesTrak element sets (CORS, no key, 6 h cache, stale-on-offline). Lazy-loaded chunk; eager bundle unchanged.
- Decision record `docs/decisions/0006-gods-eye-view-port.md`: what was and was not taken from God's Eye View 0.1.1.

### Changed
- CSP `connect-src` now allows `https://celestrak.org`.

### Fixed
- **Black map when the satellite provider is unreachable.** If Esri (or any active basemap provider) is blocked, rate-limited or silent, the map now detects it from tile errors or tiles that never answer, switches to the next usable source (Sentinel-2, then a street map), and says so in a persistent notice with a "Try again" button. The failed provider is remembered for 30 minutes so a reload starts on the working source. Choosing a basemap yourself counts as a retry. Logic in `src/map/tile-health.js` (23 tests), wiring in `src/map/map.js`, notice in `src/ui/map-notice.js`.
- App start-up (AOI, mission tools, toolbar wiring) no longer waits for the first basemap tiles, only for the style, so a slow provider cannot leave the controls dead.

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
