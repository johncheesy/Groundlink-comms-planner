# Dispatch — GroundLink M9 (cellular layer) + M10 (3D view)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds two milestones, verifies them in the browser, and
ships them.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(project guide, constraints), then the two authoritative specs you will
implement:

- **`docs/M9-connectivity-layers.md`** — cellular (LTE/3G/4G/5G) coverage modelled
  from OpenCelliD towers through the existing terrain engine.
- **`docs/M10-3d-view.md`** — 3D terrain (already present) + OSM building
  extrusion via OpenFreeMap.

M1–M7 are built. **M8 (power & endurance) is a separate dispatch
(`dispatch-M8.md`)** — build it independently, in any order relative to this one.
This task is M9 and M10 only.

## Hard constraints (non-negotiable)

- **Free / no-key only.** No paid or key-gated services. OpenCelliD data ships as
  a **static snapshot** (no runtime key); OpenFreeMap vector tiles are keyless.
- **OPSEC.** Never commit real mission/site coordinates. OpenCelliD tower data is
  public (CC BY-SA) — committing a snapshot is fine; **attribute it**. Any
  OpenCelliD API key used to *generate* a snapshot stays in the local environment
  and is **never committed**.
- **No secrets in the repo.** No `localStorage`/`sessionStorage` assumptions in
  embedded previews (in-memory is fine).
- **Verify in a real browser** with `npm run dev` before declaring any step done;
  `npm run build` must be clean before any commit to main.
- Keep it dependency-light; justify any new dependency (none should be needed —
  OpenFreeMap is a source URL, OpenCelliD is static JSON).

## Pre-flight — the working tree may carry uncommitted M6/M7 work

The Cowork session that wrote these specs also left **uncommitted M6 + M7 +
quick-win + rename work** in the tree (and possibly a stale `.git/index.lock`).
Before starting:

```bash
rm -f .git/index.lock            # if present
git status                       # review what's uncommitted
```

If the M6/M7 batch is still uncommitted, **commit and merge it first** (it is
finished and verified — see its files: `src/pace/*`, `src/radios/roles*.js`,
`docs/M6-*.md`, `docs/M7-*.md`, `docs/decisions/0003-*.md`, plus edits to
`index.html`, `src/main.js`, `styles/components.css`, `src/map/basemaps.js`,
`src/mission/mission-tools.js`, `src/radios/radios.js`). Then branch off updated
`main` for this task:

```bash
git checkout main && git pull
git checkout -b feat/m9-m10-cellular-3d
```

(If the user already shipped M6/M7, just branch off `main`.)

---

## Task 1 — M9: cellular connectivity layer

Implement `docs/M9-connectivity-layers.md` exactly. High-level order:

1. **Data prep** — `scripts/fetch-opencellid.mjs` (Node): reads `OPENCELLID_KEY`
   from env (never committed), downloads + filters towers for a bbox/MCC, writes
   `public/cells/<region>.json` (`{region,generated,attribution,cells:[{lat,lon,
   radio,mcc,net,range,samples}]}`). Ship one small **NL** snapshot as default.
   Document regeneration in the script header.
2. **`src/connectivity/cellular.js`** (pure parts unit-tested) — band→frequency
   presets + EIRP/height/sensitivity defaults; select towers by radio type +
   viewport; hand them to the existing multi-tx coverage worker (`txs[]`) per
   band; reuse the signal palette.
3. **UI** — a "Cellular coverage" layer toggle + radio-type (2G/3G/4G/5G) + band
   preset + editable EIRP/height; tower-count readout + **OpenCelliD CC BY-SA
   attribution**. Independent of mission radio coverage; sane z-order.
4. **Caveats in-app** — crowdsourced; omni vs sectorised; planning-grade.

Verify against the M9 acceptance criteria. Commit plan:

```
feat(connectivity): OpenCelliD snapshot + data-prep script (no runtime key)
feat(connectivity): cellular band presets + tower→coverage model + tests
feat(ui): cellular coverage layer toggle, filters, attribution
```

## Task 2 — M10: 3D view (terrain already exists; add buildings)

Implement `docs/M10-3d-view.md` exactly. High-level order:

1. **Building source** — add the **OpenFreeMap** vector source in `buildStyle`
   (`src/map/basemaps.js`); confirm the current tiles endpoint when wiring.
2. **`buildings-3d` `fill-extrusion`** layer (source-layer `building`,
   `render_height`/`render_min_height`, `minzoom: 14`, neutral surface token,
   hidden by default).
3. **Wire into the existing 3D toggle** (`src/map/map.js` already has
   `setTerrain`/`toggleTerrain`/`isTerrainOn`): turning 3D on enables terrain
   **and** shows buildings; off hides both + resets pitch/bearing. Add
   `setBuildings(on)` / `set3D(on)`.
4. **z-order** — terrain → basemap → coverage raster → buildings on top.
5. **Parked option** — write `docs/decisions/0004-3d-view.md` recording Google
   Photorealistic 3D Tiles / Cesium OSM Buildings as the keyed, paid path; **do
   not build it.**

Verify against the M10 acceptance criteria (toggle 3D in Amsterdam → relief +
extruded buildings; off resets to 2D; coverage + buildings coexist; responsive at
z≥14). Commit plan:

```
feat(map): OpenFreeMap vector source + 3D building extrusion layer
feat(map): fold buildings into the 3D toggle (terrain + buildings)
docs(decisions): 0004 — photorealistic 3D tiles parked (keyed/paid)
```

---

## Verification (before shipping)

- `npm run dev` → walk both acceptance lists in the browser (cellular raster from
  the NL snapshot; 3D terrain + buildings in a city).
- `npm run test` → existing + new unit tests pass.
- `npm run build` → zero errors.

## Ship

```bash
git push -u origin feat/m9-m10-cellular-3d
gh pr create --fill
gh pr merge --merge --delete-branch
```

GitHub Actions builds + deploys `main` to Pages. Confirm the live site
(https://johncheesy.github.io/Groundlink-comms-planner/) returns 200 and the
build badge updated, and that the deploy run has no deprecation warnings.

## If a decision is genuinely open

Surface it rather than guessing (e.g. the exact OpenFreeMap tiles URL, or the
default snapshot region). Prefer the spec's stated default; note any deviation in
the PR description.
