# E2 — ITU-R P.1812 as the core propagation engine

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

- [ ] `p1812.js` passes the ITU reference vectors within tolerance.
- [ ] Worker runs P.1812 in 30 MHz–6 GHz with terrain (+ clutter when present),
      falls back to FSPL+Deygout outside that range or without terrain.
- [ ] Coverage raster, site recommendation, contours and export all still work
      unchanged downstream.
- [ ] Model selector + p/pL settings work; result card names engine + percentile.
- [ ] DSM-only path runs terrain-only (no double-count); decision recorded in
      `docs/decisions/`.
- [ ] `npm test` green; `npm run build` clean; both themes; UI stays responsive.
