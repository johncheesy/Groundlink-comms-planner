# Dispatch — GroundLink M20 (UX refinement: grouped nav · stepper · result card · palette · map rail)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M20, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M20-ux-refinement.md`** — grouped toolbar + plan stepper, left-menu
  group headers + status badges (panel **and** collapsed strip), analysis
  result card + visible stale-plan pill, ⌘K command palette, and one right
  map rail with flyouts. **No colour/token changes.**

M1–M19 are built and deployed. M20 builds directly on the M19 (rev 2) UI:
survey `src/ui/toolbar.js` (+ `TOOLBAR_MODULES`), `tabs.js`, `lpanel.js`,
`objects.js` (registry + dirty/recompute flow), `search.js`, the
`.map-toolbar` block in `index.html`, and `styles/components.css` before
coding. Do not change any RF model or export format.

## Hard constraints (non-negotiable)

- **No colour changes.** Existing tokens only; the only token whose *value*
  may change is `--toolbar-h` (for the group labels).
- **Free / no-key, no new dependencies, no network calls.**
- **OPSEC.** No real coordinates anywhere (tests synthetic); nothing user-
  placed leaves the browser except explicit export.
- `localStorage` only for UI prefs (`gl.ui.groups.v1`).
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main.
- Domain-neutral wording; both themes; keyboard + ARIA per spec;
  `prefers-reduced-motion` respected on card/pill/flyout transitions.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # tree should be clean (M19 + sky fix shipped)
git checkout main && git pull
git checkout -b feat/m20-ux-refinement
```

## Step 1 — Tests first (TDD): pure logic

Per spec §Tests, write before implementing:
`src/ui/groups.test.js`, `src/ui/planstate.test.js`, `src/ui/badges.test.js`,
`src/analysis/summary.test.js`, `src/ui/palette.test.js`,
`src/ui/rail.test.js`.

## Step 2 — Shared grouping (`groups.js`) + toolbar + stepper

Spec §0–§1. Render clusters with labels + separators; stepper chip from
`planstate.js`; click-through to tabs; roving tabindex preserved.

## Step 3 — Left-menu group headers + badges

Spec §2. Sticky group headers toggling member tabs; `gl.ui.groups.v1`;
`badges.js` rendered in headers, on sections, and on the strip buttons in
`lpanel.js`.

## Step 4 — Result card + stale pill

Spec §3. `summary.js` (flood-fill dead zones, top 5) + `resultcard.js`;
hook the stale pill into the registry's existing dirty/debounce path so the
countdown matches the real timer; × cancels the auto-run and leaves the
stale badge.

## Step 5 — Command palette

Spec §4. Extend `search.js` into the ⌘K palette with `palette.js` ranking;
providers: registry objects, action list, place/coordinate search, tabs.
Remove the old in-map search box; toolbar search button opens the palette.

## Step 6 — Right map rail

Spec §5. One rail, flyouts for basemap (incl. variants) and view (3D,
buildings, tilt, bearing, op date/time); `rail.js` state machine; keep all
existing ids/handlers; delete the floating `view-sliders` block; bottom-
sheet fallback ≤ 900 px.

## Step 7 — Verify in the browser (manual checklist)

`npm run dev`, walk the spec's acceptance checklist in **both themes** and
at ≤ 900 px. Full flow: fresh app (stepper 1) → draw AOI (✓, badge) → add
radios (✓) → run coverage (card with pct/zones/weakest; stepper all ✓) →
drag a mast (pill + amber dots; cancel; recompute) → ⌘K: object, MGRS
string, "Recompute coverage", open tab → rail flyouts incl. variants and
op-time.

## Step 8 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "M20: UX refinement — grouped nav, plan stepper, result card, command palette, map rail"
git push -u origin feat/m20-ux-refinement
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` ("Open / later"). Parked (not in M20): empty-state/onboarding,
undo for moves.
