# M35 — Antenna / mast height optimisation wizard

> **Status: built (link mode) — 12 Jun 2026.** Implementation notes at the
> bottom; spec kept as written.

Feature from the 12 Jun 2026 research (`../../GroundLink_feature-onderzoek.docx`,
`../../roadmap-2026H2.md` → M35). Inspired by Cambium LINKPlanner's automatic
height optimisation: for a placed site, find the **minimum antenna height that
clears the terrain/clutter** for its binding links — "raise the mast until line
of sight is good." Small, high-value, and on-brand for a terrain-aware tool.

**Why.** Mast height is the single biggest lever a planner controls, and today
it's trial-and-error: nudge the height, re-run, eyeball the plot. A wizard that
returns "Mast Alpha needs ≥ 14 m to clear the ridge to the demand area; 9 m
leaves a 2.1 m Fresnel intrusion at 4.3 km" turns guesswork into a number.

No colour/token changes. Free/no-key, client-side, no new deps — it reuses the
existing terrain sampler and the M14 path-profile / Fresnel maths.

---

## Decisions to lock before build

1. **What it optimises against.** Two modes: **(a) link mode** — minimum height
   to satisfy a clearance target on a chosen link (site → a demand point, a
   second site, or the binding talk-in link); **(b) coverage mode** — minimum
   height to reach a target % coverage of the AOI (or of demand points). Ship
   **link mode first** (deterministic, cheap, explainable); coverage mode is an
   optional second tab (re-runs coverage at candidate heights — heavier).
2. **Clearance target.** Default to the **60 % first-Fresnel-zone** rule (the
   M14 path profile already computes the Fresnel ellipsoid). Expose the target
   (e.g. 60 % / 100 %, or a dB diffraction-loss budget) as an advanced field.
3. **Search method.** The clearance-vs-height function is monotonic (more height
   never hurts LOS), so a **bisection** on height between min (mounting height)
   and a cap (default 30 m, editable) converges in ~6 evaluations — fast enough
   on the main thread for link mode; coverage mode runs in the worker.
4. **Scope of "site".** Operate on the selected registry object (M19) of kind
   mast/relay. Result is **advisory** — it proposes a height; the user applies
   it (which routes through the normal dirty/recompute + undo flow), never
   auto-mutates.

---

## A. Core (`src/analysis/mast-height.js`, pure, TDD)

```js
// Minimum height (m) at the tx end that meets the clearance target on one link.
export function minHeightForLink({
  txLatLng, rxLatLng, rxHeightM,
  freqMHz, profileSampler,          // terrain+clutter sampler (E1 interface or Terrarium)
  target = { kind: 'fresnel', fraction: 0.6 },
  minM, maxM,                       // search bounds
}) { /* bisection → { heightM, clearanceAt: [{distM, marginM}], limited } */ }

// Worst-case over several links (binding link = the tightest).
export function minHeightForLinks(links, opts) { /* → { heightM, bindingLink } */ }
```

- Reuse the **M14 path-profile** routine to get terrain+clutter+Fresnel along
  tx→rx; the clearance margin at each sample is (ray height − terrain − clutter −
  Fresnel·fraction). A height clears iff the minimum margin ≥ 0.
- `limited: true` when even `maxM` fails to clear — the wizard then reports the
  best achievable margin and names the blocking obstacle (max-deficit sample),
  so the planner can relocate instead.
- Pure: the sampler is injected (the E1 `ElevationSource`/`ClutterSource`, or the
  current Terrarium sampler), so this module has no DOM and unit-tests with a
  synthetic profile.

## B. Wizard UI (`src/ui/mast-wizard.js`)

- Entry: a "Optimise height" action on a selected mast/relay (object context
  menu from M19, and the site's panel section). ⌘K gains "Optimise mast height".
- Link mode panel: pick the link target (binding talk-in by default; or choose a
  demand point / another site on the map), show the **recommended height**, a
  compact **path-profile preview** (reuse the M14 chart) with the clearing ray
  drawn, and the limiting obstacle + distance. "Apply 14 m" button writes the
  height through the normal registry update (dirty flag + recompute + undo).
- Coverage mode tab (optional): target % slider, "Find height", returns the
  minimum height reaching that coverage (worker run with a small height sweep) —
  clearly marked heavier.
- Honesty: heights are clearance-driven and planning-grade; the panel says so and
  links to the same caveat as the path profile.

## C. Integration

- No new map layers; the preview reuses the M14 path-profile chart component.
- Applying a height is **one registry op** → existing M20 stale pill + M21 undo
  cover it with no special casing.
- Works for the drone relay (M2.1) too: there "height" is the drone AGL altitude —
  same `minHeightForLink`, bounded by the drone's ceiling.

---

## Tests (vitest, pure logic)

- `mast-height.test.js` — on a synthetic single-ridge profile, bisection returns
  the analytically-known clearing height within tolerance; monotonicity
  (height ≥ result always clears, below never does); `limited:true` path names
  the max-deficit obstacle; multi-link picks the tightest as binding; 60 % vs
  100 % Fresnel ordering (stricter target → taller mast).
- Edge: rx height changes shift the result correctly; flat profile returns the
  mounting minimum.

DOM/interaction verified manually in the browser (standing rule): optimise a
mast that is blocked by a ridge, apply the height, watch coverage recompute and
the link close; undo restores the prior height.

## Constraints & non-goals

- No new dependencies, no network calls, no token; OPSEC unchanged.
- No colour/token changes; both themes; keyboard + ARIA; advisory only (never
  auto-mutates a height).
- Out of scope: multi-variable optimisation (height + position together),
  structural/cost modelling of taller masts (M8/M26 own cost), antenna
  down-tilt/pattern optimisation (pairs later with M36 antenna patterns).

## Acceptance checklist

- [x] Link mode returns the minimum clearing height for a selected link, with
      the path-profile preview and limiting-obstacle readout.
- [x] "Apply" writes the height via the normal dirty/recompute/undo flow.
- [x] `limited` case reports best margin + blocking obstacle instead of a false
      number.
- [x] Works for masts/relays and the drone relay (as AGL altitude, ceiling cap).
- [x] `npm test` green; `npm run build` clean; both themes; keyboard-operable.

---

## Implementation notes (built 12 Jun 2026)

- **Closed form instead of bisection.** The locked decision assumed a numeric
  search over the monotone clearance-vs-height function; the clearance margin
  at every profile sample is actually *linear* in the tx tip height
  (los(t) = txTip·(1−t) + rxTip·t), so each sample demands
  txTip ≥ (eff + frac·r1 − rxTip·t)/(1−t) and the answer is the max over
  interior samples — one pass, exact, same monotonicity guarantee (asserted in
  tests: the returned height clears, half a metre less never does). Same
  intent as the bisection — fast, deterministic, explainable — just exact.
- **Geometry**: effective profile = ground + k = 4/3 earth bulge + clutter
  (bare at the terminals, the P.1812/E2 convention). One notch more physical
  than the M14 chart, which omits the bulge over short paths. Samplers come
  through the **E1 seam**, so local COGs and the OPFS offline package feed the
  wizard exactly like a coverage run.
- **Apply paths**: drone → `drone.setAltitude` (registry.sync already arms the
  stale pill); masts → the global `#txHeight` input + the same
  `objects:changed {type:'settings'}` event the settings re-tune uses. Both
  push an undo op (verified live: apply 7.7 m → undo restores 10 → redo).
- **Entry points**: object context menu ("Optimise height…", RF kinds) and the
  ⌘K palette. The spec's "site's panel section" anchor is folded into the
  context menu (the Objects row kebab opens the same menu).
- **Out of scope as specced**: coverage-mode tab (the optional height-sweep
  variant) — link mode shipped first; revisit when M30/M36 land.
- Verified in the browser against live terrain: an alpine ridge case reports
  `> 30 m … −869.7 m at the blocker (terrain 2379 m) — consider relocating`
  with Apply hidden; a clear 600 m link recommends 7.7 m and applies it.
