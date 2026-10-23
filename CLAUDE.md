# CLAUDE.md — GroundLink Comms Coverage Planner · Claude 2.1

*Build guide v2.1 — keep the filename exactly `CLAUDE.md` so Claude Code auto-loads it.*

Project guide for Claude Code. Read this, then `../context.md` (full project background) and `docs/design-tokens.md` (visual system). The visual target is the mood board `../groundlink_moodboard_v6.html`.

## What we're building

A terrain-aware **communications coverage and planning** web app. Define where comms are needed (area / fixed sites / route / points), model RF coverage over real terrain, recommend mast/relay/repeater positions, pick bands, and produce a PACE plan + comms structure. Export to KML/GeoJSON and ATAK. Domain-neutral (defence, conservation, humanitarian, SAR, mining, expedition).

## Status

**M1–M24 + E1 + E2 + M27 + M35–M50 + E3b + E4 built** (Oct 2026); main is live on GitHub Pages at PR #31, the rest sits in the open PR stack #32–#38 (merge order in this session's notes: #32→#33→#34→#35→#38→#37; #36 is superseded by #35). Since June: Copernicus GLO-30 terrain via Mapterhorn (ADR 0007), coverage grid that follows the AOI + High detail, worldwide clutter — ESA WorldCover + Meta canopy heights + GHSL building heights (ADR 0008/0009), P.1812-8 terminal clutter (ADR 0010), interference C/I view (M24), antenna model with pointing + beam wedges (M49, `docs/M49-antenna-model.md`), LEO/MEO pass window (M48, `docs/M48-leo-passes.md`), feeder loss + per-site height/power + radio links (M50, `docs/M50-site-rf-links.md`), ITU-R and field validation pages, readability pass from the 22 Oct user test (`docs/user-test-2026-10-22-ui.md`), unified Open/import router (`src/io/route.js`). Next milestone number: **M52** (M51 = 3D masts, specced in `docs/M51-3d-masts.md`, not built). Earlier shipped: shell & map (M1), terrain + FSPL/Deygout coverage (M2), drone relay (M2.1), site recommendation (M3), mission input modes (M4), radio import & mix (M5), PACE + comms-plan report (M6), radio arsenal + node roles (M7), power & endurance incl. ATAK powerbank (M8), cellular connectivity layer (M9, live Overpass/OSM towers), 3D fill-extrusion view (M10), waypoints (M11), HF/ionosphere (M12), teams + Erlang (M13), path profile / Fresnel / link budget (M14), digital-mode coverage DMR/P25/dPMR (M15), data export GeoTIFF/KMZ/GeoJSON/CivTAK (M16), offline PWA (M17), optional CloudRF ITM backend (M18), workspace UX — top icon toolbar, left menu in open/close tabs incl. Objects tab, per-object context menu, drag-to-move, shared object registry (M19), UX refinement — grouped toolbar + plan stepper, left-menu group headers + status badges, result summary card + visible stale-plan pill, ⌘K command palette, right map rail with basemap/view flyouts (M20), mission file save/load — local `*.groundlink.json`, inputs only, ⌘S + drag-drop — plus focus mode (any section fullscreen; Objects/Power dashboards), empty state and undo ⌘Z (M21), cellular tower-layer race fix + best-network indicator (M22), service-worker update flow — build-stamped caches take every deploy live immediately — plus palette typeahead (Photon), cellular signal-scale fix and locate button (M23), in-browser ITU-R P.1812 engine — pure-JS Delta-Bullington core, propagation-model selector (Auto/P.1812/FSPL+Deygout/CloudRF) with p/pL percentiles (E2, `src/coverage/p1812.js`), PMTiles/COG no-key data layer — sampler interfaces (`src/data/sources.js`), local-COG elevation/clutter via geotiff.js, Overture buildings PMTiles, offline AOI packaging to OPFS with an in-browser PMTiles v3 writer, Data rail flyout (E1, `src/data/`, `src/map/pmtiles.js`), mast-height wizard — closed-form minimum clearing height per link, context-menu/⌘K entry, apply via undo/stale flow, drone AGL variant (M35, `src/analysis/mast-height.js`, `src/ui/mast-wizard.js`), mission ops dashboard — Maven-style fused RF+cellular+drone+PACE+teams panel, right-rail flyout (M36, `src/ui/dash-ops.js`), mission brief export — print-ready HTML with map image + PACE + link budgets + radio table + OPSEC footer (M37, `src/export/brief.js`), satellite comms overview — GEO look-angle protractor, LEO network badges, AOI-synced (M38, `src/connectivity/satcom.js`, `src/ui/satcom-panel.js`), frequency deconfliction — co-channel/adjacent/protected-band/out-of-range checks on arsenal (M39, `src/analysis/freq-deconflict.js`, `src/ui/deconflict-panel.js`), frequency plan export — printable A4 landscape table with PACE tier colour coding (M40, `src/export/freq-plan.js`), network topology diagram — SVG comms chain with hover interactions + SVG export (M41, `src/ui/topology.js`), drone altitude optimizer — samples 6 AGL heights, bar chart UI, auto-applies best altitude (M42, `src/analysis/drone-optimizer.js`), coverage gap report — dead-zone table export with relay recommendations (M43, `src/export/gap-report.js`), model accuracy badge on result card with per-model ±dB margin (E3b, `src/ui/badges.js`), satellite link rain-fade engine — ITU-R P.618-14 (E4, `src/analysis/rain-fade.js`), satcom fade margin UI — Ka/Ku rain-fade badges per GEO satellite using E4 engine, indicative ±3 dB (M44, `src/ui/satcom-panel.js` updated), link-quality topology edges — FSPL margin-coded edge colours + hover tooltip on M41 SVG diagram (M45, `src/ui/topology.js` updated, `src/main.js` `computeLinkMargins()`), smart radio-to-node suggestion list — heuristic scoring (range/band/power/mode), top-3 accordion per role with Apply button (M46, `src/analysis/radio-suggest.js`, `src/ui/radio-suggest-panel.js`), mission readiness score — 0-100 gauge in ops dashboard + compact toolbar badge, 6-dimension breakdown (M47, `src/analysis/readiness.js`, `src/ui/dash-ops.js` updated), globe projection — 3D terrain view switches to spherical globe (not infinite flat plane), reverts to Mercator on exit (`src/map/map.js` updated). Specs in `docs/` cover M2–M10, M19 (`docs/M19-workspace-ux.md`), M20 (`docs/M20-ux-refinement.md`), M21 (`docs/M21-mission-file-focus.md`), M22 (`docs/M22-cellular-bestnet.md`), M23 (`docs/M23-sw-update-flow.md`, `docs/M23-fixes.md`), E2 (`docs/E2-p1812-engine.md` — implementation notes at the bottom; decision record `docs/decisions/0005-p1812-dsm-terrain-only.md`) and E1 (`docs/E1-pmtiles-cog-data.md` — implementation notes + CORS table at the bottom); M11–M18 are documented in commit messages — write a short spec in `docs/` when touching those modules. M35's spec + implementation notes live in `docs/M35-mast-height-wizard.md` (coverage-mode tab is its open follow-up). M27 (field calibration — RSSI CSV import, deviation dots, per-radio bias offsets) is built: docs/M27-field-calibration.md. M36–M43 + E4 specs are in `docs/M36-ops-dashboard.md`, `docs/M37-mission-brief-export.md`, `docs/M38-satcom-overview.md`, `docs/M39-freq-deconflict.md` (note: M39-flight-track-overlay.md is a future spec), `docs/M40-freq-plan-export.md`, `docs/M41-topology.md`, `docs/M42-drone-optimizer.md`, `docs/M43-gap-report.md`, `docs/E4-rain-fade.md`. M44–M47 specs: `docs/M44-satcom-fade.md`, `docs/M45-link-quality-topology.md`, `docs/M46-radio-suggest.md`, `docs/M47-readiness.md`. The 2026H2 roadmap is the source for what comes next.

## Tech stack (in use)

- **Build:** Vite + Vitest. **Language:** modern vanilla JS (ES modules). No heavy UI framework.
- **Map:** **MapLibre GL JS** — raster basemaps (Esri World Imagery, PDOK NL ortho, EOX Sentinel-2, OpenTopoMap, OpenFreeMap) + 3D terrain + building fill-extrusion. **Elevation via AWS Terrarium tiles — token-free** (the free/no-key decision of 8 Jun 2026 supersedes the old Mapbox Terrain-RGB plan). Optional CloudRF ITM backend via user-entered API key (sessionStorage only).
- **Styling:** plain CSS with the design tokens in `docs/design-tokens.md` (CSS custom properties, light + dark via `:root[data-theme="dark"]`).
- **Data (E1):** `pmtiles` (BSD-3) + `geotiff` (MIT) — justified: both small, no servers/keys, and there is no no-key alternative for static-archive vector tiles (PMTiles byte-range) or in-browser GeoTIFF sampling; geotiff's heavy decoders (lerc/zstd) code-split into lazy chunks. Offline AOI packages live in OPFS only.
- **Deploy:** GitHub Pages (public-safe build).
- Keep it dependency-light; justify every added dependency.

## Design system (must match the mood board)

- Light + dark toggle; light default; **map canvas stays dark** in both.
- **One functional accent (deep teal)**; colour carries meaning: teal = action/signal, azure = assets/tracks, amber = events; vivid aqua→rose coverage spectrum on the map.
- Fonts: **Sora** (display) + **Hanken Grotesk** (body); tabular figures for data. Never Inter/Roboto/Arial.
- Operational, map-first (EarthRanger-style): typed colour-coded features, layers panel, map tools, thin status bar.
- **Do not** produce "AI app" tells: indigo/purple gradients, gradient headline text, glassy neon cards, glow/aurora backgrounds, shiny buttons, sparkle icons, generic bento landing pages.

## Capabilities & milestones

M1–M23 are **built** — see Status above for the list. Specs: `docs/M2-propagation.md`, `docs/M2.1-drone-relay.md`, `docs/M3-site-recommendation.md`, `docs/M4-mission-inputs.md`, `docs/M5-radio-import.md`, `docs/M6-pace-report.md`, `docs/M7-node-roles.md`, `docs/M8-power-endurance.md`, `docs/M9-connectivity-layers.md`, `docs/M10-3d-view.md`; design decisions in `docs/decisions/`.

- **Open / later:** Longley-Rice/ITM in-browser engine (WASM; CloudRF backend covers ITM today), clutter/landcover + tree height in the core model, baking the real NL OpenCelliD snapshot (the pipeline IS wired — snapshot-first with Overpass fallback, `src/connectivity/cellsnap.js`; the committed `public/cells/nl.json` is still the labelled sample, regenerate per `docs/M9-connectivity-layers.md` addendum), photorealistic 3D tiles (gated: paid key), worker cancellation, PACE/radios focus dashboard layouts (M21 ships the generic wide grid plus the Objects/Power dashboards; project save/share is **done** — the local mission file).

## Proposed repo structure

```
GROUNDLINK CODE/
  index.html
  src/            # map, coverage, recommend, mission, radios, pace, export, ui
  styles/         # tokens.css (from docs/design-tokens.md), components.css
  public/         # static assets
  docs/           # design-tokens.md, decisions, notes
  CLAUDE.md  README.md
```

## Conventions

- CSS custom properties for all colour/spacing/type; never hardcode theme colours in components.
- Tabular numerals for all data; sentence case for labels (no aggressive ALL-CAPS tracking).
- Mobile: panel becomes a slide-over; call `map.invalidateSize()` on resize/orientation.
- Heavy compute is chunked/async with a progress indicator; keep the UI responsive.
- Accessibility: maintain contrast in both themes; keyboard-operable controls.

## Constraints (hard)

- **OPSEC:** never commit real site coordinates. Public build ships with an empty reference network; users import their network at runtime (client-side only, never uploaded). Keep any coordinate-bearing build local/private.
- **No secrets** in the repo or in chat. Use local credentials for deploy. Tokens (e.g. Mapbox) are user-entered at runtime, not stored in source.
- **No `localStorage`/`sessionStorage` assumptions in embedded previews;** in-memory state is safe everywhere, persistence only on the hosted origin. Policy: API keys (CloudRF) are sessionStorage-only; non-sensitive user state (radio arsenal `gl.radioset.v1`, theme) may use localStorage with try/catch fallback.
- Respect data-source licensing (FCC/ETSI/manufacturer); attribute map/tile providers.

## Commands (fill in once scaffolded)

- `npm install`
- `npm run dev` — local dev server (use this to actually test in a browser)
- `npm run build` — production build
- `npm run deploy` — publish public-safe build to GitHub Pages

## How to work here

- Prefer small, verifiable steps; run the dev server and check the browser before declaring done.
- Ask before destructive actions or large dependency additions.
- When a decision is open (see `../context.md`), surface options rather than guessing.
