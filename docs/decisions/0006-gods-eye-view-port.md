# 0006 — What to take from God's Eye View 0.1.1 (and what not)

**Date:** 17 Sep 2026 · **Status:** accepted · **Context:** request to "merge" the God's Eye View 0.1.1 release (github.com/bilawalsidhu/gods-eye-view, MIT) into GroundLink.

## Problem

God's Eye View (GEV) is a Cesium-based OSINT globe: live aircraft, ships, satellites, quakes, fires, CCTV, traffic, voice control via OpenAI Realtime, and a ~7,700-line Vite dev-server that proxies every keyed API. GroundLink is a MapLibre RF coverage planner that ships as a static, key-free GitHub Pages build with a strict CSP allowlist and an OPSEC rule against real coordinates. The two share `vite` and `mgrs` and nothing else. A code merge is not meaningful; the question is which *ideas or small modules* transfer.

## Decision

**Ported (M48):** LEO/MEO pass prediction for the satcom panel — SGP4 via `satellite.js` on CelesTrak element sets, adapted from GEV's `src/data/issPass.js` scan pattern and generalised to a constellation window. It closes a gap M38 documented itself, needs no server (CelesTrak sends CORS headers), and adds one small MIT dependency that is lazy-loaded. See `docs/M48-leo-passes.md`.

**Not ported, with reasons:**

| GEV capability | Why not |
|---|---|
| Cesium globe, photorealistic 3D tiles, GLSL sensor looks (FLIR/NVG/CRT), HUD, cockpit, detection boxes | Different renderer and a paid Google key. ADR 0004 keeps MapLibre; the roadmap parks Cesium/3D Tiles until a key is acceptable. Visual language also conflicts with the design brief ("serious geospatial tool, no cockpit theatre"). |
| Voice control (OpenAI Realtime), HUD summaries | Needs a server-side key broker; GroundLink is static and key-free by design. |
| Live flights (OpenSky/adsb.lol), AIS vessels, military flights/installations, rocket launches, ISS | Awareness feeds, not planning inputs. Several need a proxy or key; OpenSky is non-commercial; military layers conflict with the domain-neutral brief. M60 (flight-track overlay) is about *imported* drone routes, not ADS-B. |
| CCTV, traffic (TomTom/Overpass), bikeshare, internet radio, regional news, weather effects | Out of domain. |
| Bundled datasets: TeleGeography cables (CC BY-NC-SA), datacenters, dams, Natural Earth | Licence (NC) or irrelevance; would also breach the "no baked data with coordinates" habit of the public build. |
| USGS earthquakes, NASA FIRMS fires | Keyless quakes could be an "events" layer for humanitarian/SAR users, but it is a new feature, not a merge — noted here as a candidate, not built. FIRMS needs a key. |
| EGM96 geoid (`egm96-universal`) | GroundLink works in AGL over Terrarium DEM; no ellipsoidal-height conversion is needed anywhere. |
| Share links (camera/layers/target in URL) | Coordinates in URLs are exactly what OPSEC forbids in public artifacts; the local mission file (M21) is the sanctioned way to share. |
| Pinokio one-click installer, setup doctor, dev-fresh scripts, key setup panel | Server-side tooling for a keyed app; nothing to install here. |
| Label arbiter, render governor, overlay allocation worker, annotations engine | Cesium-specific rendering infrastructure. |

## Consequences

- One new runtime dependency (`satellite.js`), lazy-loaded; eager bundle unchanged.
- One new CSP host (`https://celestrak.org`).
- The GEV `DATA_SOURCES.md` pattern (one table of every live source with licence and required attribution) is worth copying for the BR1 docs-truth pass; GroundLink's attribution today lives only in `src/map/basemaps.js` strings. Not done in this change.
