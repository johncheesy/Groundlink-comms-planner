# M20 — UX refinement (grouped nav · plan stepper · result card · palette · map rail)

Follow-up to M19 (rev 2). Layout/interaction only — **no colour/token changes**;
reuse `styles/tokens.css`, add layout metrics only where named. Agreed
11 Jun 2026 from the Cowork design review of the shipped M19 UI:

1. **Grouped toolbar + plan stepper** — the 13 flat toolbar icons become four
   labelled clusters; a stepper chip shows mission → radios → plan progress.
2. **Left menu groups + status badges** — the same four clusters as group
   headers in the left menu; status badges there and on the collapsed strip.
3. **Result summary card + stale pill** — after analysis, a floating card with
   % covered / dead zones / weakest link and next actions; visible "plan
   outdated" pill when a move/settings change arms the auto-recompute.
4. **Command palette** (⌘K / Ctrl-K) — objects, actions, coordinates, tabs.
5. **Right map rail** — the seven floating tool groups consolidate into one
   icon rail with flyouts (basemap variants, view/3D/op-time).

Improvement "empty state" was reviewed and **not** included in M20.

---

## 0. Shared grouping model — `src/ui/groups.js` (TDD)

One source of truth used by the toolbar, the left-menu group headers and the
collapsed icon strip; clusters over the existing `TOOLBAR_MODULES` keys:

```js
export const NAV_GROUPS = [
  { key: 'mission',  label: 'Mission',  modules: ['objects', 'mission', 'aoi'] },
  { key: 'radios',   label: 'Radios',   modules: ['radios', 'roles'] },
  { key: 'analysis', label: 'Analysis', modules: ['coverage', 'sites', 'drone', 'cellular'] },
  { key: 'output',   label: 'Output',   modules: ['pace', 'power', 'export', 'layers'] },
];
```

Helper `groupFor(moduleKey)`. Test: every `TOOLBAR_MODULES` key appears in
exactly one group; unknown keys throw.

## 1. Grouped toolbar + plan stepper

- `toolbar.js` renders per `NAV_GROUPS`: icon cluster + an 11 px group label
  under it, hairline separators between clusters. `--toolbar-h` may grow to
  fit the label (≤ 52 px) — keep one token.
- Existing behaviour unchanged: button = open/close that tab; roving
  tabindex now walks groups in order; `aria-label` gains the group
  ("Coverage — Analysis").
- **Stepper chip** (right of the module clusters, before search): three
  steps `1 Mission · 2 Radios · 3 Plan` derived from a pure selector
  `planState(state)` in `src/ui/planstate.js` (TDD):
  - mission done = AOI set **or** ≥1 RF object placed;
  - radios done = arsenal non-empty;
  - plan done = a current (non-stale) coverage/PACE result exists.
  Returns `{step: 1|2|3, done: {mission, radios, plan}, stale}`.
- Step states: done (accent ✓), current (ink), todo (faint). Click a step →
  opens that group's first relevant tab. Chip hides below 900 px.

## 2. Left menu groups + status badges

- Insert a **group header row** above each cluster's sections (markup stays
  in `index.html`; `tabs.js` learns about group headers). Sticky within the
  panel scroll (`position: sticky; top: 0`), existing surface colours only.
- The panel sections are **reordered in `index.html`** to match the cluster
  order (Cellular coverage moves up into Analysis; Signal legend rides with
  Analysis after Coverage; Data export/Power sit in Output). Each cluster's
  sections are wrapped in a `.panel-group` container whose header toggles
  everything inside it — the wrapper, not a module list, defines membership
  in the DOM, so non-module sections (legend) collapse with their group.
- Group header toggles its member tabs together (`aria-expanded`); member
  tabs keep their own toggles. Persist the closed-group set in
  `localStorage` `gl.ui.groups.v1` (same pattern/class as `gl.ui.tabs.v1`).
- **Badge model** — pure `src/ui/badges.js` (TDD): from app state produce
  per-module and per-group badges:
  - objects → count; aoi → ✓ when set; radios → count or "0";
  - coverage → amber stale dot when the plan is dirty (same flag as §3);
  - group badge = aggregate of its modules (counts sum; dot wins over ✓).
- Badges render in group headers, on section headers (right-aligned, 11 px)
  and on the collapsed strip icons (`lpanel.js` strip buttons get a badge
  span). Colours: existing tokens only (`--accent`, `--warn`, `--dim`).

## 3. Result summary card + stale pill

- **Summary** — pure `src/analysis/summary.js` (TDD with a synthetic
  raster): from the coverage result + AOI polygon compute
  `{coveredPct, deadZones: [{centroid, areaKm2}], weakestDbm}`. Dead zones =
  connected components of below-threshold cells inside the AOI (8-neighbour
  flood fill, ranked by area, top 5).
- **Card** (`src/ui/resultcard.js`): floating, bottom-centre over the map
  after an analysis run; shows the three figures + dead-zone rows
  (click → `flyTo` centroid) and two actions: **Relay advice** (opens the
  site-recommendation tab and triggers the existing run) and **Report**
  (existing M6 report action). Dismiss (×) and auto-restore on next run;
  never blocks map interaction outside its box; hides while dragging.
- **Stale pill**: M19's silent debounced recompute becomes visible. When the
  registry marks the plan dirty (move/settings), show a top-centre pill:
  cause ("Mast Alpha moved"), **Recompute now**, and the auto countdown the
  debounce already implies; × cancels the auto-run (plan stays stale, badge
  dot from §2 remains). Uses `--warn` styling patterns already present.
  Metric: the visible debounce is **5 s** (counted down per second on the
  pill) — M19's silent 400 ms is too short to read or cancel; the pill is the
  trade (longer delay, but visible, cancellable, and skippable via
  **Recompute now**). Routing is unchanged: drone → `computeRelay()`, other
  RF kinds → `runCoverage()`; recommend-owned masts stay excluded.
- `aria-live="polite"` on both; respect `prefers-reduced-motion`.

## 4. Command palette (⌘K / Ctrl-K)

- Promote the existing map search (`search.js`) to a palette: same input,
  grouped results — **Objects** (registry: name match → select/flyTo),
  **Actions** (recompute coverage, toggle 3D, export …, open tab X — a
  static action list with the same handlers the UI already has),
  **Go to** (existing place search + coordinate parsing, all three formats),
  **Tabs** (open/close by label).
- Pure ranking model `src/ui/palette.js` (TDD): providers in, query in →
  ordered sections out (prefix > word > fuzzy; objects above actions on
  name hits; max 6 per section).
- Open with ⌘K/Ctrl-K or the toolbar search button; overlay centred at top
  third; full keyboard (↑↓ ⏎ Esc), `role="dialog"` + listbox semantics;
  closes on outside click. The old in-map search box is removed (one entry
  point), its placeholder hint moves into the palette.

## 5. Right map rail

- Consolidate `.map-toolbar` into **one vertical rail** (one surface, one
  border-radius): zoom ± · basemap · view · import · path profile. Order
  fixed; 32 px buttons; separators between view/data/analysis clusters.
- **Flyouts** (one open at a time, anchored left of the rail, Esc/outside
  click closes, `aria-expanded` on the anchor):
  - **Basemap**: imagery/topo choice + the variant list (replaces chips +
    long-press variant menu — discoverable now);
  - **View**: 3D terrain toggle, buildings toggle, tilt + bearing sliders
    (the floating `view-sliders` block is removed), operation date/time
    (the raw `datetime-local` input moves here with a readable label).
- Small controller `src/ui/rail.js` (TDD: open/close state machine — open A
  then B closes A; Esc closes; map click closes).
- All existing element ids/handlers keep working (markup moves, wiring
  stays); mobile ≤ 900 px keeps the rail, flyouts become bottom sheets.

---

## Tests (vitest, pure logic only)

- `groups.test.js` — full coverage of TOOLBAR_MODULES, single membership.
- `planstate.test.js` — step derivation incl. stale plan and empty app.
- `badges.test.js` — per-module + aggregate badges; dot beats ✓.
- `summary.test.js` — synthetic raster: pct, component count, ranking,
  weakest dBm; AOI clipping.
- `palette.test.js` — ranking rules, section caps, coordinate queries.
- `rail.test.js` — flyout state machine.

DOM/interaction verified manually in the browser (standing rule).

## Constraints & non-goals

- No colour/token additions (only `--toolbar-h` may change value); no new
  dependencies; no network calls; OPSEC unchanged; domain-neutral wording;
  both themes; keyboard + ARIA as specified per feature.
- `localStorage` UI prefs only: `gl.ui.groups.v1`.
- Out of scope: empty-state/onboarding (reviewed, parked), undo for moves,
  mobile-specific redesign beyond the fallbacks named above.

## Acceptance checklist

- [ ] Toolbar shows four labelled clusters; stepper reflects a fresh app
      (step 1), AOI set (step 2), arsenal added (step 3), result (all ✓),
      then a mast drag flips it to stale.
- [ ] Left menu: group headers collapse/expand member tabs; badges correct
      (object count, AOI ✓, radios count, amber dot when stale) in panel
      **and** on the collapsed strip; state survives reload.
- [ ] After a coverage run the card shows pct/zones/weakest; dead-zone row
      flies to the zone; Relay advice opens + runs site recommendation.
- [ ] Moving a mast shows the stale pill with cause + countdown; × cancels
      the auto-run; Recompute now runs immediately.
- [ ] ⌘K finds an object by name (Enter flies to it), parses an MGRS string,
      runs "Recompute coverage", opens a tab; Esc restores focus to the map.
- [ ] Right rail: one surface; basemap variants reachable by left-click;
      tilt/bearing/op-time live in the view flyout; no floating sliders.
- [ ] `npm test` green; `npm run build` clean; both themes; ≤ 900 px OK.
