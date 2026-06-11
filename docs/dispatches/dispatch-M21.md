# Dispatch — GroundLink M21 (mission file · focus mode · empty state · undo)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M21, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M21-mission-file-focus.md`** — (A) save/load the full mission as a
  local `*.groundlink.json` (inputs only, **results recomputed on load**),
  (B) focus mode: every section expands fullscreen via a portal, with
  dashboard layouts for Objects and Power, (C) empty state, (D) undo for
  move/rename/delete.

M1–M20 are built and deployed. Survey before coding: `src/ui/objects.js`
(registry — the file's object source and undo's target), `tabs.js` +
`lpanel.js` (panel/strip the focus surface cooperates with), the M20 dirty/
stale flow (unsaved marker + undo recompute), the import button wiring in
`src/main.js` (extend, don't fork), `src/io/` (M16 export patterns).

## Hard constraints (non-negotiable)

- **No colour/token changes.** High-tech comes from layout, hairlines,
  spacing, tabular figures — existing tokens only.
- **Free / no-key, no new dependencies, no network calls.**
- **OPSEC.** Mission file is local-only and contains the user's coordinates —
  the save dialog must say so plainly. **Never** serialize API keys or
  computed results (test enforces this). No real coordinates in tests.
- `localStorage` untouched by mission save/load (explicit files only).
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main.
- Domain-neutral wording; both themes; keyboard + ARIA per spec;
  `prefers-reduced-motion` respected.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # tree should be clean (M20 shipped, PR #12)
git checkout main && git pull
git checkout -b feat/m21-mission-file-focus
```

## Step 1 — Tests first (TDD): pure logic

Per spec §Tests: `src/io/mission.test.js`, `src/ui/focus.test.js`,
`src/ui/undo.test.js`, `src/ui/emptystate.test.js`. The mission round-trip
test must include the negative case: state containing results + a session
API key serializes to a file containing neither.

## Step 2 — Mission file (`src/io/mission.js` + wiring)

Spec §A. Serialize/parse/validate with version gate; ⌘S, Output-group and
palette Save actions; load via the existing import button, drag-drop and
palette; confirm-on-dirty before replacing state; one analyse run after
load (the same code path as the Analyse button).

## Step 3 — Focus mode (`src/ui/focus.js` + `.focus-*` CSS)

Spec §B. Expand button on every section header; portal the section node
into the focus surface over the map (no map teardown; `map.resize()` on
enter/exit); strip switches focus; Esc/⤡ exits and restores. Generic wide
grid for all sections; dashboard layouts for **Objects** (sortable table,
selection synced, context menu) and **Power** (metric cards, endurance
bars from existing M8 data, timings + ATAK side cards).

## Step 4 — Empty state + undo

Spec §C–§D. `isEmptyMission` predicate drives the centred starter card
(draw AOI / place mast / open mission); dismiss-for-good once anything
exists. Undo stack on registry ops with ⌘Z/⇧⌘Z, toast feedback, recompute
via the existing stale flow.

## Step 5 — Verify in the browser (manual checklist)

`npm run dev`, both themes, ≤ 900 px. Full loop: fresh app (empty state) →
build a small mission → ⌘S → reload app → drag the file in → identical
state, analyse re-ran once → expand Power and Objects focus views → rename
+ move + delete an object, ⌘Z each back → save again and diff the two
files (only `savedAt` differs).

## Step 6 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "M21: mission file, focus mode, empty state, undo"
git push -u origin feat/m21-mission-file-focus
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` ("Open / later": project save/share done; note PACE/radios
focus dashboards as later). Roadmap reference: `../../roadmap-2026H2.md`.
