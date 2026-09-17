# M48 — Live LEO/MEO pass window (satcom panel)

> **Status: built — 17 Sep 2026.** Ported idea from God's Eye View 0.1.1 (see `docs/decisions/0006-gods-eye-view-port.md`). Closes the M38 gap "LEO networks are static badges (not orbit-computed)".

---

## Why

M38 shows GEO look angles exactly but treats Iridium, Globalstar and O3b as fixed badges. For a handheld L-band or a MEO Ka terminal the planning question is *"is something above my mask right now, and will there be a hole in the next couple of hours?"*. That is a pass-prediction problem, and the inputs are public: CelesTrak publishes the element sets and SGP4 is a solved algorithm.

## What it does

For each LEO/MEO system in `LEO_SYSTEMS` that carries a `tle` descriptor, the satcom panel adds one live line under the badge:

```
Now 4 ≥ 10° · best 62° (IRIDIUM 133, Az 214°) · next 120 min: no gaps, lowest best-sat 23° at 14:52
  80 element sets · CelesTrak · elements 3 h old · terrain mask not applied
```

or, when the constellation is sparse at that latitude:

```
None ≥ 10° now · next pass 15:07, peak 41° · next 120 min: 3 gaps, longest 26 min
```

- **Mask** 10° (handheld L-band planning value), **horizon** 120 min, **step** 60 s — constants at the top of `src/ui/satcom-panel.js`.
- **Starlink** deliberately has `tle: null`: ~7,000 element sets and always many in view — a count is not a planning signal (and the download is ~1 MB). Its badge stays static.
- **O3b** lives inside CelesTrak's `ses` group; entries are filtered with `match: '^O3B'`.

## Data flow

```
satcom-panel.update({lat,lng})
  └─ render()                          synchronous, unchanged GEO table
       └─ runLeoLive(host, lat, lng, seq)   async
            ├─ import('../connectivity/leo-pass.js')   ← satellite.js in its own Vite chunk
            ├─ import('../connectivity/leo-tle.js')
            ├─ loadGroupTle(group)      CelesTrak gp.php, CORS *, 6 h localStorage cache, stale-on-offline
            ├─ parseTle → toSatrecs
            └─ constellationWindow()    sats × 121 SGP4 propagations (Iridium ≈ 9.7k, tens of ms)
```

`seq` is a token bumped on every `update()`/`clear()`; a stale computation from a previous AOI never writes into the panel.

## Sources and policy

- **CelesTrak** `https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&FORMAT=tle` — sends `Access-Control-Allow-Origin: *`, so the static GitHub Pages build fetches it directly. Added to the CSP `connect-src` allowlist in `index.html`.
- CelesTrak asks for ≥ 2 h between refreshes of a group; we cache 6 h (`gl.tle.<group>.v1`, localStorage behind try/catch — public orbital data, not user state). Offline, the cached copy is served and the line says "(cached, offline)".
- **satellite.js** ^6.0.2 (MIT) — the one dependency added. Justification: SGP4 is not something to hand-roll; 6.x is pure JS (7.x adds a WASM build that drags Node shims into the browser bundle). It is only reachable via dynamic import, so the eager bundle is unchanged.
- Terrain masking is **not** applied, same as the GEO table. The M42 roadmap item (DSM horizon mask) is the natural next step: feed `constellationWindow()` a per-azimuth mask instead of a scalar.

## Files

| File | Change |
|---|---|
| `src/connectivity/leo-pass.js` | new — `parseTle`, `toSatrecs`, `lookAnglesAt`, `subpointAt`, `constellationWindow` |
| `src/connectivity/leo-tle.js` | new — `loadGroupTle` with TTL cache + stale fallback |
| `src/connectivity/leo-pass.test.js` | new — 19 tests, fixture is one public Iridium element set; observer positions derived from its sub-point (no real coordinates) |
| `src/connectivity/satcom.js` | `tle` descriptor per LEO system |
| `src/ui/satcom-panel.js` | live line + `runLeoLive()` |
| `styles/components.css` | `.satcom-leo-live*` |
| `index.html` | CSP `connect-src` + `https://celestrak.org` |
| `package.json` | `satellite.js` |

## Open follow-ups

1. Per-azimuth terrain mask from the DSM (roadmap M42) → feed into the window scan.
2. Surface the worst-case LEO availability in the M47 readiness score (today only the GEO best status feeds `dimSatcom`).
3. Mission brief (M37): include the pass-window line under Satcom.
