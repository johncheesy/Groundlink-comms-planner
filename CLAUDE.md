# CLAUDE.md — GroundLink Comms Coverage Planner · Claude 2.1

*Build guide v2.1 — keep the filename exactly `CLAUDE.md` so Claude Code auto-loads it.*

Project guide for Claude Code. Read this, then `../context.md` (full project background) and `docs/design-tokens.md` (visual system). The visual target is the mood board `../groundlink_moodboard_v6.html`.

## What we're building

A terrain-aware **communications coverage and planning** web app. Define where comms are needed (area / fixed sites / route / points), model RF coverage over real terrain, recommend mast/relay/repeater positions, pick bands, and produce a PACE plan + comms structure. Export to KML/GeoJSON and ATAK. Domain-neutral (defence, conservation, humanitarian, SAR, mining, expedition).

## Status

**M1–M19 built and shipping** (June 2026). The app is live on GitHub Pages. Shipped: shell & map (M1), terrain + FSPL/Deygout coverage (M2), drone relay (M2.1), site recommendation (M3), mission input modes (M4), radio import & mix (M5), PACE + comms-plan report (M6), radio arsenal + node roles (M7), power & endurance incl. ATAK powerbank (M8), cellular connectivity layer (M9, live Overpass/OSM towers), 3D fill-extrusion view (M10), waypoints (M11), HF/ionosphere (M12), teams + Erlang (M13), path profile / Fresnel / link budget (M14), digital-mode coverage DMR/P25/dPMR (M15), data export GeoTIFF/KMZ/GeoJSON/CivTAK (M16), offline PWA (M17), optional CloudRF ITM backend (M18), workspace UX — top icon toolbar, left menu in open/close tabs incl. Objects tab, per-object context menu, drag-to-move, shared object registry (M19). Specs in `docs/` cover M2–M10 and M19 (`docs/M19-workspace-ux.md`); M11–M18 are documented in commit messages — write a short spec in `docs/` when touching those modules.

## Tech stack (in use)

- **Build:** Vite + Vitest. **Language:** modern vanilla JS (ES modules). No heavy UI framework.
- **Map:** **MapLibre GL JS** — raster basemaps (Esri World Imagery, PDOK NL ortho, EOX Sentinel-2, OpenTopoMap, OpenFreeMap) + 3D terrain + building fill-extrusion. **Elevation via AWS Terrarium tiles — token-free** (the free/no-key decision of 8 Jun 2026 supersedes the old Mapbox Terrain-RGB plan). Optional CloudRF ITM backend via user-entered API key (sessionStorage only).
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

M1–M18 are **built** — see Status above for the list. Specs: `docs/M2-propagation.md`, `docs/M2.1-drone-relay.md`, `docs/M3-site-recommendation.md`, `docs/M4-mission-inputs.md`, `docs/M5-radio-import.md`, `docs/M6-pace-report.md`, `docs/M7-node-roles.md`, `docs/M8-power-endurance.md`, `docs/M9-connectivity-layers.md`, `docs/M10-3d-view.md`; design decisions in `docs/decisions/`.

- **Open / later:** Longley-Rice/ITM in-browser engine (WASM; CloudRF backend covers ITM today), clutter/landcover + tree height in the core model, calibration with field RSSI, project save/share, best-server + interference views, auto-cost BOM from priced inventory, real OpenCelliD snapshot for the cellular layer (`scripts/fetch-opencellid.mjs` exists but is not wired up), photorealistic 3D tiles (gated: paid key), worker cancellation, code-splitting of the >1 MB main bundle.

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
