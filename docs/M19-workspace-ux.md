# M19 — Workspace UX overhaul (toolbar · object panel · context menu · drag)

Layout-only milestone: **no colour/token changes** — everything reuses
`styles/tokens.css` as-is. Goal: turn the single long left panel into a
map-first workspace with four new interaction patterns, mocked up and agreed
on 10 Jun 2026:

1. **Top toolbar** — a thin icon bar above the map, one icon per module.
2. **Right object panel** — list of all placed objects (masts/repeaters,
   markers/points, waypoints, drones); clicking a toolbar icon opens the
   matching menu here; panel is **resizable by dragging** its divider.
3. **Context menu** (right mouse button) on every placed object — coordinates
   (copy, all formats), rename, settings (masts/repeaters), move, delete.
4. **Drag-to-move** — every placed point can be repositioned by dragging;
   dependent outputs (coverage, PACE, power, profile) recompute.

Plus: the **left panel stays but collapses to an icon strip** (decision Keith,
10 Jun 2026 — option "inklapbaar links").

---

## 0. Architecture prerequisite — a single object registry

Today sites/points/waypoints/drone live in separate modules with their own
markers. M19 needs one shared inventory to drive the right panel, the context
menu and drag behaviour.

New pure module **`src/ui/objects.js`** (TDD):

```js
// One entry per user-placed map object.
// kind: 'tx' | 'mast' | 'repeater' | 'marker' | 'waypoint' | 'drone'
{ id, kind, name, lngLat: [lng, lat], settings: {…}, locked: false }
```

- `registry.add/update/move/rename/remove(id)` — emits a single
  `objects:changed` event (detail: `{type, id}`) on `document`.
- Existing modules (mission inputs, recommended sites, waypoints, drone)
  **register their objects** here instead of keeping private lists. They keep
  owning their domain logic; the registry is only the UI inventory + event bus.
- Default names on create: `Mast A`, `Mast B`, … / `Marker 1` / `Drone 1`
  (rename anytime). Names export with KML/GeoJSON and import back (M16 keeps
  round-trip).

**Recompute rule:** any `move` or settings change for an RF-relevant object
(tx/mast/repeater/drone) triggers the same debounced re-run the panel's
"Analyse" path uses today (~400 ms after drag end, cancel-and-restart).
Markers/waypoints recompute nothing RF, but do refresh route/profile outputs
that reference them.

## 1. Top toolbar

- New `header.toolbar` row in the app grid:
  `rows: var(--toolbar-h) 1fr var(--status-h)`. New token `--toolbar-h: 44px`
  (layout metric, not a colour).
- Left: brand (moves out of the panel header). Then one icon button per
  module, same order as today's panel sections: mission, AOI, radios, roles,
  coverage, sites, drone, PACE, export, power, cellular, 3D/features. Right:
  search, basemap, theme toggle, settings.
- Icons: inline SVG, stroke style consistent with existing UI; `aria-label` +
  `title` on every button; roving tabindex; visible focus ring.
- Click behaviour: opens that module's menu **in the right panel** (see §2)
  and marks the icon active (`aria-pressed`). The icon for a module with
  unsaved/active state (e.g. coverage job running) may show the existing
  spinner/badge patterns — no new colours.
- The toolbar replaces nothing yet: the left panel sections remain the
  authoritative forms in this milestone (the right panel hosts *views/menus*,
  not duplicated forms — see §2).

## 2. Right object panel (resizable)

- New `aside.rpanel` column: grid becomes
  `columns: var(--panel-w) 1fr 6px var(--rpanel-w)` (collapsed left panel
  changes the first track, §5). New tokens `--rpanel-w: 280px`,
  min 200 / max 480.
- **Divider drag:** 6 px hit area, `cursor: col-resize`, pointer-capture drag
  clamps to min/max; double-click resets to default. Width persists in
  `localStorage` (`gl.ui.rpanel.v1`) — UI preference only, OPSEC-fine (same
  class as theme).
- **Default view — "Objects":** the registry list. Each row: kind icon,
  name, short grid ref in the active coordinate format (reuse the status-bar
  formatter), kebab/right-click for the same context menu as on the map.
  Click row → select + highlight marker; double-click → fly to.
- Selected object shows a **detail footer**: full coords (copy), and for
  masts/repeaters/drone the key RF fields (freq, power, antenna/height) with
  an "Edit" button that opens the owning section in the left panel
  (scroll + expand), not a duplicate form.
- **Toolbar-driven views:** clicking a toolbar icon swaps the right-panel
  content to that module's menu — for M19 this is a *summary/list* view per
  module (e.g. coverage: active jobs + legend; export: the existing export
  actions). Implementation: a small view-switcher (`data-rview`), each view a
  template rendered from existing state. Keep it thin; deep forms stay left.
- Panel can be hidden entirely (toolbar toggle, `Esc` closes a non-default
  view back to Objects). Mobile/narrow (<900 px): right panel becomes an
  overlay sheet, same content.

## 3. Context menu on objects

- Extend the existing map `contextmenu` handler (quick win #3): if the hit
  test (`queryRenderedFeatures` / marker element) finds a registry object,
  show the **object menu**; otherwise keep today's coords-only menu.
- Menu (custom positioned `role="menu"`, keyboard navigable, closes on
  `Esc`/outside click):
  - header: object name + kind;
  - **coordinates** in lat/lng, MGRS and UTM — each row click-to-copy
    (reuse the existing formatter + copy util, with the "copied" toast);
  - **Rename…** — inline input in the menu, Enter commits (registry.rename);
  - **Settings…** — masts/repeaters/tx/drone only: opens the owning left-panel
    section (same target as §2 "Edit");
  - **Move** — arms drag mode for the next pointer-down (alternative to direct
    drag, useful on touch);
  - **Delete** — with the existing confirm pattern.
- Same menu from the right-panel row kebab (one implementation, two anchors).

## 4. Drag-to-move

- All registry markers become draggable (MapLibre `Marker({draggable})` where
  markers are DOM markers; for layer-rendered points, pointer-down on the
  feature + `map.dragPan.disable()` during the move, re-enable on drop).
- During drag: live coordinate readout in the status bar (already shows live
  coords) + a subtle dashed leader line from the origin (map-layer, uses
  existing feature colours only).
- On drop: `registry.move(id, lngLat)` → debounced recompute (§0). `Esc`
  during drag cancels and snaps back.
- Locked objects (`locked: true`, e.g. imported reference network) don't
  drag; context menu shows "Unlock" instead of Move.

## 5. Left panel — collapsible to icon strip

- Keep the current panel and sections untouched, add a **collapsed state**:
  `--panel-w` swaps to `--panel-w-collapsed: 52px`; sections render as a
  vertical icon strip (same icons as the toolbar modules).
- Collapse toggle: the existing `#panelCollapse` button becomes this
  (chevron flips). State persists (`gl.ui.lpanel.v1`).
- Collapsed: clicking a strip icon expands the panel *and* scrolls to that
  section (expanding is one click, never a hover flyout). Tooltips show
  section names. `aria-expanded` reflects state.
- Width transition ≤ 150 ms ease-out; map resizes via the existing
  `map.resize()`-on-container-change handling.

---

## Tests (vitest, pure logic only)

- `objects.test.js` — add/rename/move/remove, event payloads, default-name
  sequencing (`Mast A`→`B`), locked rejects move, kind validation.
- `rpanel.test.js` — width clamp (200–480), persist/restore round-trip,
  double-click reset.
- `ctxmenu.test.js` — menu model builder: per kind, which items appear
  (marker: no Settings; locked: Unlock instead of Move), coord rows present
  in all three formats.

DOM/interaction behaviour is verified manually in the browser (the repo's
standing rule) — see the dispatch checklist.

## Constraints & non-goals

- **No colour/token additions beyond layout metrics** (`--toolbar-h`,
  `--rpanel-w`, `--panel-w-collapsed`). No new fonts, shadows, gradients.
- No new dependencies; no network calls; OPSEC rules unchanged (names and
  coordinates of user objects never leave the browser except via explicit
  export).
- Domain-neutral wording in all new UI strings.
- Keyboard + screen-reader support on toolbar, menus, divider
  (divider: `role="separator"`, `aria-valuenow`, arrow keys resize).
- Out of scope for M19: moving the left-panel forms into the right panel,
  multi-select, undo history (registry events are designed so undo can come
  later).

## Acceptance checklist

- [ ] Toolbar present in both themes; every icon keyboard-reachable; active
      state correct.
- [ ] Right panel lists every placed object; resizes by drag within clamps;
      width survives reload.
- [ ] Right-click on a mast: coords copyable in 3 formats; rename works and
      shows up in list + export; Settings jumps to the correct section.
- [ ] Dragging the TX mast recomputes coverage after drop; Esc cancels.
- [ ] Left panel collapses to icon strip and restores; state survives reload.
- [ ] `npm test` green; `npm run build` clean; mobile layout not broken.
