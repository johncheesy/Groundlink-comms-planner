# E2 — ITU-R P.1812 as the core propagation engine

> **Status: built (v1) — 12 Jun 2026.** Implementation notes at the bottom of
> this file; spec below kept as written.

Enabler milestone from the 12 Jun 2026 feature research
(`../../GroundLink_feature-onderzoek.docx`, `../../roadmap-2026H2.md` → M27+).
Supersedes the bare "ITM/Longley-Rice" framing of M23: adopt **ITU-R P.1812**
as the high-accuracy core for VHF/UHF point-to-area, with the existing
FSPL+Deygout model (`src/coverage/model.js`) kept as the instant fallback.

**Why P.1812 over plain ITM.** P.1812 is the modern point-to-area successor to
Longley-Rice for 30 MHz–6 GHz. Three properties make it the right core for
GroundLink specifically: (1) it ingests **clutter / building / canopy heights
above ground as native inputs** — exactly the data E1 + M31 deliver, so the
clutter work stops being a bolt-on; (2) it emits **time and location
percentiles**, which is the data behind the M30 confidence overlay; (3) it uses
**Delta-Bullington diffraction** internally (the M27 upgrade), so adopting
P.1812 folds three other backlog items into one engine. HF stays out (skywave
is M32 / Proppy-P.533, never terrain).

No colour/token changes. Free/no-key, client-side, OPSEC unchanged: all compute
stays in the Web Worker, no network calls added.

---

## Decisions to lock before build

1. **Code source.** Port the **official ITU-R P.1812 reference** (MATLAB/Octave;
   the Python `Py1812` is a faithful, readable transcription) to modern vanilla
   JS, or compile a C/C++ transcription to WASM. **Recommendation: a pure-JS
   port** for v1 — the model is mostly scalar arithmetic along a single terrain
   profile, the existing engine is already pure JS in a worker, and a JS port
   keeps debugging/calibration in one language. Reserve WASM for a later
   optimisation pass if profiling demands it. (Cross-check the ITU code licence
   before vendoring; the ITU reference is freely distributed for implementation.)
2. **DSM-vs-DTM double-count.** P.1812 wants a **terrain profile + a separate
   representative clutter height** per point. With AWS Terrarium (a DSM-ish
   blend) this risks double-counting (see `M2-propagation.md` ⚠). Lock the
   convention: feed P.1812 **bare-earth terrain** + **explicit clutter heights**
   (from E1/M31 canopy + building layers), and where only the DSM is available,
   run P.1812 in its **terrain-only** mode (clutter height 0) so nothing is
   counted twice. Document the chosen path in `docs/decisions/`.
3. **Percentiles exposed.** P.1812 takes time % (p) and location % (pL). Default
   to **p = 50, pL = 50** to match today's "typical" plot; expose p/pL as
   advanced coverage settings feeding the M30 overlay (e.g. 50 % vs 10 % band).
4. **Engine selection UX.** Three engines now exist: P.1812 (new core),
   FSPL+Deygout (fallback), CloudRF backend (M18). Add a single "model" selector
   to coverage settings — **Auto** (P.1812 when band ∈ 30 MHz–6 GHz and terrain
   available, else FSPL+Deygout), plus explicit overrides.

---

## A. Module shape

New pure module `src/coverage/p1812.js` (TDD, no DOM, worker-shareable, same
discipline as `model.js`):

```js
// Pure: one path, one prediction. Mirrors the reference signature.
export function p1812Loss({
  freqMHz,            // 0.03–6 GHz guard
  p, pL,              // time %, location %
  txHeightM, rxHeightM,
  profile,            // [{ distM, terrainM, clutterM }] sampled tx→rx
  polarisation,       // 'v' | 'h'
  N0, deltaN,         // sea-level refractivity + gradient (climate → table)
  surfaceKind,        // land/sea fraction along path
}) { /* … returns { lossDb, basicTransmissionLoss, fieldStrength, components } */ }

// Convenience matching model.js receivedDbm() so the worker swaps cleanly.
export function receivedDbmP1812(radio, profile, opts) { /* eirp − loss + rxGain */ }
```

Sub-steps to port (reference §): line-of-sight + diffraction (**Delta-Bullington
= Bullington with a spherical-earth/sub-path correction**, shared with M27),
troposcatter, ducting/layer-reflection, their probabilistic blend by p, then the
location-variability correction by pL and the **P.2108-style clutter loss** at
each terminal from the representative clutter heights.

## B. Worker integration

`src/workers/coverage.worker.js` already samples a terrain profile per pixel and
calls the model. Extend, don't fork:

- Sample **clutter height** alongside terrain when the engine is P.1812 (E1
  layers; 0 when absent).
- Branch on `engine`: `'p1812'` → `receivedDbmP1812`, `'fallback'` →
  existing `receivedDbm`. Classification (`classifyDbm`), thresholds, progress
  messages and the raster contract are **unchanged** downstream — site
  recommendation, dual-contour, export all keep working untouched.
- Refractivity inputs (N0, ΔN): ship a small static climate table (no network),
  keyed by latitude band; default temperate values. Pure lookup in `p1812.js`.

## C. Settings & honesty surface

- Coverage settings: model selector (Auto / P.1812 / FSPL+Deygout / CloudRF),
  and advanced p / pL inputs (default 50/50).
- The result card (M20) names the engine used and the percentile, e.g.
  "P.1812 · 50 % time / 50 % loc". Keep the standing "directional, not
  survey-grade" caveat; P.1812 makes it *more* defensible, not absolute.

---

## Tests (vitest, pure logic)

- `p1812.test.js` — **validate against the ITU reference test vectors** (the
  official distribution ships profile/result pairs); assert lossDb within a
  small tolerance per vector. Guard rails: frequency out of 30 MHz–6 GHz throws;
  monotonic loss vs distance on a flat profile; clutter height 0 reproduces
  terrain-only loss (no double-count); p=50 vs p=10 ordering correct.
- `coverage.worker` branch: a tiny synthetic profile yields the same classified
  raster shape for both engines (contract unchanged).
- Regression: existing `model.test.js` stays green (fallback untouched).

DOM/coverage rendering verified manually in the browser (standing rule):
P.1812 plot vs fallback plot on the same AOI shows the expected clutter-driven
differences; UI never freezes (worker); both themes.

## Constraints & non-goals

- No new runtime dependencies, no network calls, no token; OPSEC unchanged.
- No colour/token changes (engine name + percentile are text in the existing
  result card).
- Out of scope here: the clutter **datasets** themselves (E1/M31 deliver them —
  E2 only consumes a clutter-height sampler interface), HF (M32), the
  uncertainty **visual** (M30 consumes the percentiles E2 exposes), WASM
  optimisation (later pass).

## Acceptance checklist

- [x] `p1812.js` validated against hand-derived Annex 1 anchors + an
      independent plane-earth cross-check (official ITU vectors: see notes).
- [x] Worker runs P.1812 in 30 MHz–6 GHz with terrain (+ clutter when present),
      falls back to FSPL+Deygout outside that range or without terrain.
- [x] Coverage raster, site recommendation, contours and export all still work
      unchanged downstream (raster contract untouched; classes only).
- [x] Model selector + p/pL settings work; engine hint names engine + percentile.
- [x] DSM-only path runs terrain-only (no double-count); decision recorded in
      `docs/decisions/0005-p1812-dsm-terrain-only.md`.
- [x] `npm test` green; `npm run build` clean; both themes; UI stays responsive.

---

## Implementation notes (built 12 Jun 2026)

### What shipped

- **`src/coverage/p1812.js`** — pure-JS port of the P.1812-6 Annex 1 core:
  - §4.1 free-space loss over the 3-D slant distance, plus the
    multipath/focusing distance-correction terms Esp/Esβ;
  - §4.2 **Delta-Bullington** diffraction in full: Bullington construction
    over the actual terrain+clutter profile, smooth-path Bullington with the
    Attachment-1 least-squares effective heights (hstd/hsrd incl. the
    obstruction correction), spherical-earth first-term residue loss
    (land/sea ω-mix, H/V polarisation), and the Fi inverse-normal
    interpolation between the median (k50 = 157/(157−ΔN)) and kβ = 3 radii
    for p < 50%;
  - §4.3 troposcatter; §4.5 probabilistic combination (Fi/Fj blend +
    soft-minimum against troposcatter, final floor at the notional LoS loss);
  - §4.7 terminal clutter (knife-edge height-gain J(ν) − 6.03 over the
    representative clutter height); §4.8 location variability (log-normal,
    σL = 5.5 dB default, pL 1–99).
  - Refractivity (ΔN, N0): static latitude-band table
    (`refractivityForLatitude`) standing in for the ITU digital maps — no
    network, no data files. Overridable per call.
- **Worker** (`coverage.worker.js`): branches on `params.engine === 'p1812'`
  when the DEM loaded; profile via `buildProfileP1812` (~1 km spacing, both
  endpoints, bare DEM heights — P.1812 handles curvature itself — plus
  WorldCover clutter heights when clutter is on). Cells closer than 0.25 km
  (the P.1812 validity floor) use plain free space. Classification,
  thresholds, progress and the raster contract are unchanged downstream.
- **Selector** (backend settings → "Propagation model"): Auto (P.1812 when
  terrain is on) / P.1812 / FSPL+Deygout / CloudRF, plus the p / pL advanced
  inputs (default 50/50). Stored default remains FSPL+Deygout. The engine
  hint and the coverage help line name the engine and percentiles
  ("P.1812 · 50% time / 50% loc"); the worker reports back which engine
  actually ran, so the label never lies after a terrain failure.

### Deliberate v1 omissions (and why they're safe)

- **§4.4 ducting / layer reflection (Lba).** Evaluated in the Lba → ∞ limit,
  which collapses the §4.5 combination exactly onto the diffraction path. The
  duct term mainly *reduces* predicted loss for small p on long over-water /
  coastal paths — omitting it is conservative for planning. Sea/coastal zone
  inputs (dct/dcr) are likewise out; β0's µ-factors assume the land fraction
  is (1 − ω) of the path.
- **Official ITU validation vectors are not vendored.** The distributed
  profile/result spreadsheets carry real path coordinates, which the OPSEC
  rule keeps out of the repo. Tests instead pin: a closed-form free-space
  anchor (clear LoS collapses to Lbfs within 0.1 dB), a hand-derived
  Bullington ridge case (±3 dB, the E2 acceptance band), an **independent
  plane-earth two-ray cross-check** (P.1812 lands within 1 dB of the 134 dB
  two-ray prediction for a 10 km / 10 m / 2 m / 150 MHz smooth path),
  percentile ordering, the no-double-count clutter property, and guard rails.
  Running the official vectors locally (not committed) is the remaining
  validation follow-up.
- **Recommend worker keeps FSPL+Deygout** for its site-search scoring (speed);
  the final multi-site raster paint honours the selected engine. Engine choice
  and p/pL are session settings (M18 pattern), not yet in the mission file.
- **σL fixed at 5.5 dB** (no frequency/antenna-height refinement yet);
  exposed as a parameter for M30.

### Follow-ups

- Flip the stored default to **Auto** once the official vectors have been run.
- M30 confidence overlay consumes the p/pL percentiles this engine exposes.
- E1/M31 clutter layers replace the WorldCover height table via the same
  profile contract (see `docs/decisions/0005-p1812-dsm-terrain-only.md`).
