# Dispatch — GroundLink M35 (mast / antenna height optimisation wizard)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M35, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M35-mast-height-wizard.md`** — for a selected mast/relay, find the
  **minimum antenna height that clears terrain + clutter** for its binding link
  (link mode, ship first) with an optional coverage-target mode. Reuses the M14
  path-profile / Fresnel maths and the existing terrain sampler; advisory only.

Survey before coding: `src/analysis/path-profile.js` (M14 — terrain+clutter+
Fresnel along a tx→rx ray; you reuse its sampling and chart), `src/coverage/
model.js` (`K_FACTOR`, geometry helpers), `src/ui/objects.js` (the M19 registry —
selected object, context menu, the update op your "Apply" routes through),
the M20 stale/dirty flow and M21 undo (your height change must ride these with
no special casing), and the drone relay (M2.1) input for the AGL-altitude case.

## Hard constraints (non-negotiable)

- **No new dependencies, no network calls, no token.** Pure terrain/Fresnel
  maths on the existing sampler.
- **Advisory only** — the wizard proposes a height; the user applies it, and
  applying is **one registry op** that routes through the existing dirty +
  recompute + undo flow. Never auto-mutate a height.
- **OPSEC unchanged**; no coordinates in tests.
- **No colour/token changes.** Both themes; keyboard + ARIA.
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # clean tree
git checkout main && git pull
git checkout -b feat/m35-mast-height-wizard
```

## Step 1 — Tests first (TDD): the optimiser

`src/analysis/mast-height.test.js`. On a synthetic single-ridge profile,
bisection returns the analytically-known clearing height within tolerance;
monotonicity (≥ result always clears, below never does); `limited:true` path
names the max-deficit obstacle; multi-link picks the tightest as binding;
60 % vs 100 % Fresnel ordering; rx-height sensitivity; flat profile → mounting
minimum.

## Step 2 — Core optimiser (`src/analysis/mast-height.js`)

Spec §A. Pure, DOM-free, sampler injected. `minHeightForLink(...)` bisects
height in `[minM, maxM]` using the M14 path-profile clearance margin (ray −
terrain − clutter − Fresnel·fraction); returns `{ heightM, clearanceAt, limited }`.
`minHeightForLinks(...)` returns the worst-case height + binding link. `limited`
reports best margin + blocking obstacle when even `maxM` fails.

## Step 3 — Wizard UI (`src/ui/mast-wizard.js`)

Spec §B. "Optimise height" action on a selected mast/relay (M19 context menu +
the site panel; ⌘K "Optimise mast height"). Link mode: pick the link target
(binding talk-in default, or click a demand point / another site), show the
recommended height, a path-profile preview (reuse the M14 chart) with the
clearing ray drawn, and the limiting obstacle + distance. "Apply <h> m" writes
via the normal registry update. Optional coverage-mode tab (target % slider →
worker height sweep), clearly marked heavier. Keep the planning-grade caveat.

## Step 4 — Integration

Spec §C. No new map layers (preview reuses M14). Applying a height = one registry
op → M20 stale pill + M21 undo with no special casing. Support the drone relay
case (height = AGL altitude, bounded by ceiling).

## Step 5 — Verify in the browser (manual checklist)

`npm run dev`, both themes. Optimise a mast blocked by a ridge → apply the height
→ coverage recomputes and the link closes → undo restores the prior height.
Check the `limited` case (an unreachable demand point names the blocker, not a
false number). Drone-relay altitude case works. Keyboard-operable.

## Step 6 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "M35: mast/antenna height optimisation wizard (link mode + coverage mode)"
git push -u origin feat/m35-mast-height-wizard
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` (Status + note coverage-mode/down-tilt as later, the latter pairing
with M36 antenna patterns). Roadmap reference: `../../roadmap-2026H2.md`.
