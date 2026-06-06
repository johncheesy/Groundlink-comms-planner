# CLAUDE.md — GroundLink Comms Coverage Planner · Claude 2.1

*Build guide v2.1 — keep the filename exactly `CLAUDE.md` so Claude Code auto-loads it.*

Project guide for Claude Code. Read this, then `../context.md` (full project background) and `docs/design-tokens.md` (visual system). The visual target is the mood board `../groundlink_moodboard_v6.html`.

## What we're building

A terrain-aware **communications coverage and planning** web app. Define where comms are needed (area / fixed sites / route / points), model RF coverage over real terrain, recommend mast/relay/repeater positions, pick bands, and produce a PACE plan + comms structure. Export to KML/GeoJSON and ATAK. Domain-neutral (defence, conservation, humanitarian, SAR, mining, expedition).

## Status

Greenfield. A single-file prototype exists separately as design/behaviour reference (FSPL + knife-edge coverage, AOI draw, site recommendation, KML import/export, mobile slide-over). We are rebuilding it as a maintainable project — keep the proven behaviour, raise the engineering and design quality.

## Tech stack (proposed — confirm before scaffolding)

- **Build:** Vite. **Language:** modern vanilla JS (ES modules) + TypeScript if/when useful. No heavy UI framework to start.
- **Map:** lean to **MapLibre GL JS** — vector basemaps + **3D terrain** (terrain-RGB DEM source) + **building extrusion** + pitch/tilt, so a **3D view is native**. Leaflet 1.9 (prototype) is 2D-only and acceptable only if 3D is dropped. Raster bases: Esri World Imagery + OpenTopoMap; elevation via Mapbox Terrain-RGB.
- **Styling:** plain CSS with the design tokens in `docs/design-tokens.md` (CSS custom properties, light + dark via `:root[data-theme="dark"]`).
- **Deploy:** GitHub Pages (public-safe build).
- Keep it dependency-light; justify every added dependency.

## Design system (must match the mood board)

- Light + dark toggle; light default; **map canvas stays dark** in both.
- **One functional accent (deep teal)**; colour carries meaning: teal = action/signal, azure = assets/tracks, amber = events; vivid aqua→rose coverage spectrum on the map.
- Fonts: **Sora** (display) + **Hanken Grotesk** (body); tabular figures for data. Never Inter/Roboto/Arial.
- Operational, map-first (EarthRanger-style): typed colour-coded features, layers panel, map tools, thin status bar.
- **Do not** produce "AI app" tells: indigo/purple gradients, gradient headline text, glassy neon cards, glow/aurora backgrounds, shiny buttons, sparkle icons, generic bento landing pages.

## Capabilities & milestones

- **M1 — Shell & map:** layout (panel · map · status), basemaps, light/dark, AOI draw (radius + polygon), mobile slide-over. Match mood board.
- **M2 — Terrain & coverage:** see **`docs/M2-propagation.md`** (authoritative). Summary: core model = Longley-Rice/ITM compiled to **WASM in a Web Worker** (prefer the public-domain NTIA reference; FSPL+Deygout as fallback); terrain via Mapbox Terrain-RGB (GLO-30/SRTM optional); clutter from ESA WorldCover + canopy height; talk-in as binding link; coverage raster with the signal scale. HF is a separate later module (not ITM). Optional Phase-B backend (signal-server / ITU-R P.1812) for heavy/offline-edge.
- **M2.1 - Drone / airborne relay (branch of M2):** see **`docs/M2.1-drone-relay.md`**. Drone/UAS as an elevated repeater (tx at altitude -> coverage gain; airborne relay as a PACE path, multi-hop chaining) + a drone operating/link envelope from a position (terrain LOS + link budget by altitude band, with terrain-shadow zones). Reuses the M2 terrain + engine; payload/endurance/tether caveats surfaced; regulatory/BVLOS overlays later.
- **M3 — Site recommendation:** candidate generation from DEM local maxima within AOI; greedy set-cover over demand points; draggable sites; recompute.
- **M4 — Mission input modes:** area / fixed sites / route / points; coordinate entry in lat/long, MGRS, UTM; click-to-place.
- **M5 — Radio import & mix:** search + import radios; pull specs from FCC OET/FCC ID (+ ETSI/CE, datasheets); user-editable; multi-band radio-mix recommendations.
- **M6 — PACE & comms plan + report:** generate PACE and a comms-structure summary; exportable report (PDF/Word) with sites, link budget, bands.
- **M7 — Export/interop:** KML + GeoJSON, Google Earth + ATAK round-trip.
- **Later:** Longley-Rice/ITM engine (or signal-server backend), clutter/landcover + tree height, calibration with field RSSI, project save/share, best-server + interference views, offline/edge, auto-cost BOM, power/solar budgeting; 3D map view (terrain relief + extruded buildings + coverage drape on the terrain).

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
- **No `localStorage`/`sessionStorage` assumptions in embedded previews;** in-memory state is safe everywhere, persistence only on the hosted origin.
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
