# GroundLink Comms Coverage Planner

Terrain-aware communications coverage and planning, in the browser. Define where comms are needed (area, fixed sites/repeaters, a route, or points), model RF coverage over real terrain, get recommended mast/relay positions, a suitable radio mix, and a PACE + comms plan. Exports to KML/GeoJSON and ATAK.

Domain-neutral: defence, conservation/anti-poaching, humanitarian, search & rescue, mining, expedition.

## Project layout

- `CLAUDE.md` — build guide for Claude Code (start here when coding).
- `../context.md` — full project background, decisions, research, OPSEC.
- `docs/design-tokens.md` — colours, type and theming (light + dark).
- Visual reference: `../groundlink_moodboard_v6.html`.

## Getting started

```bash
npm install
npm run dev      # local dev server (Vite) — open the printed http://localhost:5173/
npm run build    # production build to dist/
npm run preview  # serve the production build locally
```

Open this folder in Claude Code and follow `CLAUDE.md` (Milestone 1 first).

## Stack (M1)

- **Build:** Vite 6 · modern vanilla ES modules.
- **Map:** Leaflet 1.9 with raster basemaps (Esri World Imagery, OpenTopoMap, CARTO dark). See `docs/decisions/0001-map-library.md` for the Leaflet-vs-MapLibre call.
- **Styling:** plain CSS with the design tokens in `styles/tokens.css` (light + dark; the map canvas stays dark in both). Fonts: Sora + Hanken Grotesk.
- AOI drawing (radius circle + polygon) is built on Leaflet primitives — no `leaflet-draw` dependency.

## Notes

- Web-first; offline/edge is a later phase.
- OPSEC: no real coordinates are committed; users import their network at runtime (stays in the browser). No secrets in the repo.
