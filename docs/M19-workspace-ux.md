# M19 — Workspace UX overhaul (toolbar · object panel · context menu · drag)

Layout-only milestone: **no colour/token changes** — everything reuses
`styles/tokens.css` as-is. Goal: turn the single long left panel into a
map-first workspace with four new interaction patterns, mocked up and agreed
on 10 Jun 2026 (**rev 2, same day:** everything lives on the left — the right
side of the screen stays free for the map; no right panel):

1. **Top toolbar** — a thin icon bar above the map, one icon per left-panel
   tab; clicking opens/closes that tab.
2. **Left menu in tabs** — every panel section is a tab the user opens and
   closes from its header (body slides shut); the **Objects** tab lists all
   placed objects (masts/repeaters, markers/points, waypoints, drones).
3. **Context menu** (right mouse button) on every placed object — coordinates
   (copy, all formats), rename, settings (masts/repeaters), move, delete.
4. **Drag-to-move** — every placed point can be repositioned by dragging;
   dependent outputs (coverage, PACE, power, profile) recompute.

Plus: the **left panel stays but collapses to an icon strip** (decision Keith,
10 Jun 2026 — option "inklapbaar links").

---

## 0. Architecture prerequisite — a single object registry

Today sites/points/waypoints/drone live in separate modules with their own
markers. M19 needs one shared inventory to drive the Objects tab, the context
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
  left-panel tab, in section order: objects, mission, AOI, radios, roles,
  coverage, sites, drone, PACE, export, power, cellular, 3D/features. Right:
  search, basemap, theme toggle, settings.
- Icons: inline SVG, stroke style consistent with existing UI; `aria-label` +
  `title` on every button; roving tabindex; visible focus ring.
- Click behaviour: **opens/closes that tab in the left menu** (§2) — open on
  a closed tab reveals + scrolls to it; click on an open tab closes it. On
  mobile / collapsed strip the click always opens (+ opens the panel).
  `aria-pressed` mirrors the tab's open state (several can be active).
- The toolbar replaces nothing: the left panel sections remain the
  authoritative forms — the toolbar is navigation only.

## 2. Left menu in tabs (right side of the screen stays free)

- **No right panel** — the map keeps the full width right of the left menu
  (rev-2 decision; the earlier resizable right object panel was dropped).
- Every left-panel `.section` becomes a **tab**: its header is a toggle
  (`role="button"`, `aria-expanded`, Enter/Space) with a chevron; the body
  slides shut via the grid `1fr→0fr` track transition (≤150 ms; padding
  collapses with it). Multiple tabs can be open at once; all open by default.
- The closed-tab set persists in `localStorage` (`gl.ui.tabs.v1`) — UI
  preference only, OPSEC-fine (same class as theme). Storing the *closed*
  set means new sections in later milestones default to open.
- **Objects tab** (new, first section): the registry list. Each row: kind
  icon, name, short grid ref in the active coordinate format (reuse the
  status-bar formatter), kebab/right-click for the same context menu as on
  the map. Click row → select + highlight marker; double-click → fly to.
- Selected object shows a **detail block** under the list: full coords in all
  three formats (each copyable), for RF kinds the key link line (freq, power,
  tx height / drone altitude) and an "Edit" button that reveals the owning
  section (open tab + scroll), not a duplicate form.

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
- Same menu from the Objects-tab row kebab (one implementation, two anchors).

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
- `tabs.test.js` — toggle open/close state, persist/restore round-trip under
  `gl.ui.tabs.v1`, default everything-open, corrupt/throwing storage.
- `ctxmenu.test.js` — menu model builder: per kind, which items appear
  (marker: no Settings; locked: Unlock instead of Move), coord rows present
  in all three formats.

DOM/interaction behaviour is verified manually in the browser (the repo's
standing rule) — see the dispatch checklist.

## Constraints & non-goals

- **No colour/token additions beyond layout metrics** (`--toolbar-h`,
  `--panel-w-collapsed`). No new fonts, shadows, gradients.
- No new dependencies; no network calls; OPSEC rules unchanged (names and
  coordinates of user objects never leave the browser except via explicit
  export).
- Domain-neutral wording in all new UI strings.
- Keyboard + screen-reader support on toolbar, menus and tab headers
  (headers: `role="button"`, `aria-expanded`, Enter/Space).
- Out of scope for M19: a separate right-hand panel (dropped in rev 2),
  multi-select, undo history (registry events are designed so undo can come
  later).

## Acceptance checklist

- [x] Toolbar present in both themes; every icon keyboard-reachable;
      `aria-pressed` mirrors each tab's open state.
- [x] Every section opens/closes from its header and from its toolbar icon;
      the closed set survives reload; right side of the screen stays free.
- [x] Objects tab lists every placed object with grid refs in the active
      coordinate format; selecting shows copyable coords + Edit jump.
- [x] Right-click on a mast: coords copyable in 3 formats; rename works and
      shows up in list + export; Settings jumps to the correct section.
- [x] Dragging the TX mast recomputes coverage after drop; Esc cancels.
- [x] Left panel collapses to icon strip and restores; state survives reload.
- [x] `npm test` green; `npm run build` clean; mobile layout not broken.
