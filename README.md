# GroundLink Comms Coverage Planner

Terrain-aware communications coverage and planning, in the browser. Define where comms are needed — area, fixed sites/repeaters, a route, or points — model RF propagation over real terrain, get recommended mast/relay positions, a matched radio mix, and a complete PACE plan. Exports to KMZ, GeoJSON, GeoTIFF, and CivTAK.

**Domain-neutral:** conservation/anti-poaching, humanitarian, search & rescue, mining, expedition, and defence operations.

**Live:** [johncheesy.github.io/Groundlink-comms-planner](https://johncheesy.github.io/Groundlink-comms-planner/)

---

## Feature set (v0.9.0-beta)

| Area | What it does |
|---|---|
| **Coverage modelling** | FSPL + Deygout (M2), ITU-R P.1812 Delta-Bullington in-browser (E2), optional CloudRF ITM backend (M18) |
| **Propagation models** | Auto / P.1812 / FSPL+Deygout / CloudRF — user-selectable; model accuracy badge with ±dB margin |
| **Validation** | P.1812 engine checked step by step against the ITU-R WP 3M validation set — published at `/validation/` ([docs](docs/validation-p1812.md)) |
| **Mission inputs** | Area (circle/polygon), fixed sites, route, points — lat/long, MGRS, or UTM (M4) |
| **Site recommendation** | Greedy set-cover over demand points with scored relay positions (M3) |
| **Drone relay** | Altitude optimiser — samples 6 AGL heights, bar chart UI, auto-applies best (M2.1, M42) |
| **Mast-height wizard** | Closed-form minimum Fresnel-clearing height per link; drone AGL variant (M35) |
| **Radio arsenal** | FCC/ETSI import + mix; node roles; Erlang-B traffic model; field calibration (RSSI CSV, bias offsets) (M5, M7, M13, M27) |
| **Path profile** | Fresnel zones + link budget per path (M14); topology SVG with margin-coded edges (M41, M45) |
| **Digital modes** | DMR / P25 / dPMR coverage (M15) |
| **HF / ionosphere** | NVIS/skywave modelling (M12) |
| **Cellular** | Live OpenCelliD/Overpass tower layer; best-network indicator (M9, M22) |
| **PACE plan** | Auto-generated from bands and assets; printable mission brief export (M6, M37) |
| **Frequency** | Deconfliction (co-channel/adjacent/protected-band) + printable freq-plan export (M39, M40) |
| **Satcom** | GEO look-angle protractor; LEO badges; Ka/Ku rain-fade margins (ITU-R P.618-14); live LEO/MEO pass window — SGP4 on CelesTrak elements (M38, M44, E4, M48) |
| **Data layers (E1)** | PMTiles/COG — Overture buildings, local canopy/DSM, offline AOI packaging to OPFS |
| **Mission ops** | Fused RF+cellular+drone+PACE+teams dashboard; mission readiness score (M36, M47) |
| **Smart suggestions** | Radio-to-node heuristic scoring; top-3 accordion with Apply (M46) |
| **Export** | GeoTIFF, KMZ, GeoJSON, CivTAK; coverage gap report with relay recommendations (M16, M43) |
| **Offline PWA** | Service worker with build-stamped caches; OPFS AOI packages (M17, M23) |
| **Workspace UX** | Icon toolbar, left-menu tabs, per-object context menu, drag-to-move, ⌘K palette, undo ⌘Z (M19–M21) |

---

## Stack

- **Build:** Vite 6 · modern vanilla JS (ES modules) · Vitest
- **Map:** MapLibre GL JS — raster basemaps (Esri World Imagery, PDOK NL ortho, EOX Sentinel-2, OpenTopoMap, OpenFreeMap) + 3D terrain + fill-extrusion buildings
- **Elevation:** AWS Terrarium tiles (token-free) · local GeoTIFF via `geotiff.js`
- **Vector tiles:** `pmtiles` (BSD-3) for Overture buildings + offline OPFS packages
- **Styling:** plain CSS · design tokens in `styles/tokens.css` · Sora + Hanken Grotesk · light + dark themes (map canvas dark in both)
- **Deploy:** GitHub Pages · public-safe build (no secrets, no real coordinates)

---

## Getting started

```bash
npm install
npm run dev      # local dev server — open http://localhost:5173/
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm test         # run the test suite (Vitest)
```

For development guidance, open the folder in Claude Code and read `CLAUDE.md` first.

---

## Attribution

- Elevation tiles: [Terrain Tiles (AWS Open Data)](https://registry.opendata.aws/terrain-tiles/) — Mapzen / AWS, public domain
- Basemaps: Esri (Esri World Imagery, under Esri's terms and never stored offline), national aerial imagery (see `docs/DATA-SOURCES.md`), EOX (Sentinel-2, CC BY-NC-SA), OpenTopoMap (CC-BY-SA), OpenStreetMap contributors (ODbL), CARTO, OpenFreeMap. Intended for research and other non-commercial use.
- Buildings: Overture Maps Foundation (© OpenStreetMap contributors)
- Cellular towers: OpenCelliD / Unwired Labs (CC BY 4.0) via Overpass API
- Land cover: ESA WorldCover (CC BY 4.0), via Microsoft Planetary Computer (worldwide; Digital Earth Africa WMS as fallback)
- Tree heights: Meta/WRI Canopy Height Map v2 (CC BY 4.0), via source.coop
- Radio specs: FCC OET equipment authorisation database; ETSI

---

## OPSEC

No real coordinates are committed. The public build ships with no reference network. Users import their network at runtime — data stays in the browser and is never uploaded. API keys (CloudRF) are session-only and never stored in source.

---

## Licence

Source: MIT. Map/tile/data providers are attributed above under their respective licences.
