# Dispatch — GroundLink E2 (ITU-R P.1812 core propagation engine)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds E2, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/E2-p1812-engine.md`** — adopt **ITU-R P.1812** as the high-accuracy
  core for VHF/UHF (30 MHz–6 GHz) point-to-area coverage, keeping the existing
  FSPL+Deygout model as the instant fallback. P.1812 natively ingests clutter/
  building/canopy heights and emits time/location percentiles, folding the M27
  (Delta-Bullington) and M30 (confidence) backlog items into one engine.

Also read `docs/M2-propagation.md` (the engine plan, incl. the DSM-vs-DTM
double-count warning). Survey before coding: `src/coverage/model.js` (the pure
fallback physics — `fsplDb`, `deygoutLossDb`, `receivedDbm`, `classifyDbm`,
`K_FACTOR`; your new engine mirrors its purity and its `receivedDbm` signature),
`src/workers/coverage.worker.js` (per-pixel terrain sampling + model call — you
extend its branch, not fork it), `src/coverage/dual-contour.js` and the site-
recommendation path (must keep working unchanged), `src/backends/cloudrf.js`
(the third engine the selector must coexist with).

## Hard constraints (non-negotiable)

- **Pure JS port** of the official ITU-R P.1812 reference (MATLAB/Octave; Python
  `Py1812` is a readable transcription). No WASM in this milestone. **Check and
  record the ITU reference-code licence** before vendoring any derived code.
- **No new runtime dependencies, no network calls, no token.** Refractivity
  (N0, ΔN) comes from a small static in-repo climate table, not a fetch.
- **OPSEC unchanged** — all compute stays in the Web Worker; no coordinates in
  tests; nothing leaves the browser.
- **No colour/token changes.** Engine name + percentile are text in the existing
  M20 result card.
- **Lock the DSM/DTM convention** (spec §Decision 2): feed bare-earth terrain +
  explicit clutter heights; with DSM-only data run P.1812 terrain-only (clutter
  0) so vegetation/buildings are never double-counted. Record it in
  `docs/decisions/`.
- The raster contract downstream (classification, thresholds, contours,
  recommendation, export) must be **unchanged**.
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main. Both themes.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # tree should be clean
git checkout main && git pull
git checkout -b feat/e2-p1812-engine
```

## Step 1 — Tests first (TDD): the model

Create `src/coverage/p1812.test.js`. Drive the port with the **official ITU
reference test vectors** (the P.1812 distribution ships profile/result pairs):
assert `p1812Loss()` matches each vector within tolerance. Add guard-rail tests:
out-of-band frequency throws; loss monotone vs distance on a flat profile;
clutter-height 0 reproduces terrain-only loss; p=50 vs p=10 ordering.

## Step 2 — The engine (`src/coverage/p1812.js`)

Spec §A. Pure, DOM-free, worker-shareable. Port the reference sub-steps:
LOS + **Delta-Bullington** diffraction (Bullington + spherical-earth/sub-path
correction), troposcatter, ducting/layer-reflection, probabilistic blend by `p`,
location-variability by `pL`, terminal clutter loss from representative clutter
heights. Expose `p1812Loss({...})` and a `receivedDbmP1812()` convenience that
mirrors `model.js` `receivedDbm()`. Static climate table for N0/ΔN by latitude.

## Step 3 — Worker integration (`src/workers/coverage.worker.js`)

Spec §B. Sample clutter height alongside terrain when `engine === 'p1812'`
(0 when no clutter layer); branch the per-pixel call between `receivedDbmP1812`
and the existing `receivedDbm`. Leave classification, progress messages and the
raster output contract untouched. Confirm site recommendation + dual-contour +
export still consume the raster unchanged.

## Step 4 — Settings & honesty surface

Spec §C. Add a model selector to coverage settings — **Auto** (P.1812 when band
∈ 30 MHz–6 GHz and terrain present, else FSPL+Deygout), P.1812, FSPL+Deygout,
CloudRF. Advanced p / pL inputs (default 50/50). The M20 result card names the
engine + percentile (e.g. "P.1812 · 50 % time / 50 % loc"). Keep the standing
"directional, not survey-grade" caveat.

## Step 5 — Verify in the browser (manual checklist)

`npm run dev`, both themes. Same AOI: switch P.1812 ↔ FSPL+Deygout and confirm
P.1812 shows the expected clutter-driven differences and beyond-horizon
behaviour; UI never freezes; out-of-band (e.g. HF) auto-falls back; site
recommendation + export still produce correct output.

## Step 6 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "E2: ITU-R P.1812 core propagation engine (fallback retained)"
git push -u origin feat/e2-p1812-engine
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` (Status + "Open / later": ITM/P.1812 now the core; Delta-Bullington
shipped inside it; confidence overlay (M30) can now consume p/pL) and record the
DSM/DTM decision in `docs/decisions/`. Roadmap reference: `../../roadmap-2026H2.md`.
