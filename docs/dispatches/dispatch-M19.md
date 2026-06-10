# Dispatch — GroundLink M19 (workspace UX: toolbar · object panel · context menu · drag)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M19, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M19-workspace-ux.md`** — top icon toolbar, resizable right object
  panel, per-object context menu (coords/rename/settings/move/delete),
  drag-to-move for all placed points, and a left panel that collapses to an
  icon strip. **Layout only — zero colour/token changes** beyond the three
  layout metrics named in the spec.

M1–M18 are built and deployed. M19 touches UI/layout across modules but must
not change any RF model, export format, or existing form. Before coding,
survey how objects are created today: `src/mission/` (sites/points/routes,
waypoints), `src/drone/drone.js`, `src/recommend/`, the map `contextmenu`
handler in `src/main.js` (quick win #3), and `styles/base.css` (app grid) +
`styles/tokens.css` (layout metrics).

## Hard constraints (non-negotiable)

- **No colour changes.** Reuse existing tokens; new tokens are layout metrics
  only (`--toolbar-h`, `--rpanel-w`, `--panel-w-collapsed`).
- **Free / no-key, no new dependencies, no network calls.**
- **OPSEC.** No real coordinates committed anywhere (tests use synthetic
  coords); object names/positions stay in-browser except explicit export.
- `localStorage` only for UI prefs (`gl.ui.rpanel.v1`, `gl.ui.lpanel.v1`) —
  same class as the theme preference. Never for coordinates.
- **Verify in a real browser** (`npm run dev`) before declaring done;
  `npm test` green and `npm run build` clean before any commit to main.
- Domain-neutral UI wording; both themes; keyboard + ARIA per spec.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # working tree should be clean (M18 shipped)
git checkout main && git pull
git checkout -b feat/m19-workspace-ux
```

## Step 1 — Tests first (TDD): pure logic

Write vitest cases per spec §Tests before implementing:

- `src/ui/objects.test.js` — registry add/rename/move/remove + events,
  default-name sequencing, locked-object move rejection.
- `src/ui/rpanel.test.js` — width clamp 200–480, persist/restore,
  double-click reset value.
- `src/ui/ctxmenu.test.js` — menu-model builder per object kind (marker has
  no Settings; locked shows Unlock; three coord formats always present).

## Step 2 — Object registry (`src/ui/objects.js`)

Spec §0. Pure module + event bus; then wire mission sites/points, waypoints,
recommended masts, repeaters and the drone to register/unregister. Keep
domain state where it lives today — the registry is inventory + events only.
Debounced recompute on RF-relevant move/settings change (reuse the existing
analyse pipeline; cancel-and-restart).

## Step 3 — Top toolbar + left-panel collapse

Spec §1 + §5. New grid row; brand moves to the toolbar; module icons with
`aria-label`; `#panelCollapse` becomes the icon-strip collapse with persisted
state; map resize handled on every track change.

## Step 4 — Right object panel

Spec §2. New grid column + 6 px divider (pointer-capture drag, clamps,
double-click reset, `role="separator"` + arrow-key resize). Objects view
(default) + thin per-module views switched by the toolbar. Detail footer with
copyable coords and "Edit" jumping to the owning left-panel section. Overlay
sheet under 900 px.

## Step 5 — Context menu + drag-to-move

Spec §3 + §4. Extend the existing `contextmenu` handler with object hit-test;
one menu implementation anchored from map and list rows; rename inline;
delete with confirm. Draggable markers with live coord readout, dashed leader
line, Esc-cancel, drop → `registry.move` → recompute. Locked objects don't
drag.

## Step 6 — Verify in the browser (manual checklist)

Run `npm run dev` and walk the spec's acceptance checklist in **both themes**
and at <900 px width. Specifically: place 2 masts + a marker + the drone;
rename a mast via right-click and confirm the name in the right panel **and**
in a GeoJSON export/import round-trip; drag the TX mast and watch coverage
recompute once after drop; resize + reload for both persisted widths/states.

## Step 7 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "M19: workspace UX — toolbar, object panel, context menu, drag-to-move"
git push -u origin feat/m19-workspace-ux
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` ("Open / later") and note M19 in the commit body, not in
`roadmap-next.md` (that file is a closed planning record).
