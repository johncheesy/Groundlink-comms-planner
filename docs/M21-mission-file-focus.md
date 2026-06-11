# M21 — Mission file & focus mode (save/share · fullscreen sections · empty state · undo)

Agreed 11 Jun 2026. Two halves, one milestone: **(A) project save/share** as a
local mission file (roadmap M21) and **(B) focus mode** — every left-menu
section can expand to a fullscreen, dashboard-grade view (Keith's request
from the post-M20 review: "full screen werken aan één kopje, visueel
aantrekkelijk, binnen de high-tech stijl"). Plus the two session-UX items
parked earlier: **empty state** and **undo**.

No colour/token changes; existing tokens only (the focus views must look
high-tech through layout, hairlines, spacing and tabular figures — not new
colours). Decision locked: the mission file stores **inputs only — results
are recomputed on load**.

---

## A. Mission file (save / load / share)

### Format — `*.groundlink.json`, schema v1

Pure module `src/io/mission.js` (TDD): `serializeMission(state)` /
`parseMission(json)` / `validateMission(obj)`.

```js
{
  format: 'groundlink-mission', version: 1, savedAt: ISO8601,
  mission: {
    aoi,                  // {type:'radius', center, radiusM} | {type:'polygon', ring} | null
    sites, points, route, // M4 domain slices: [{lat, lng, name}], route vertices
    waypoints,            // M11: [{lat, lng, name, icon}]
    drone,                // M2.1 input: {lngLat, altM} | null
    arsenal, structures,  // M5/M6: the radios you carry + saved structures
    coverage,             // freq, power, heights, terrain/clutter, thresholds, mode
    pace, power, teams,   // M6/M8/M13 user inputs (not outputs)
    basemap, opDatetime,  // view context worth restoring
  }
}
```

The file serializes **domain state, not the registry** — every user-placed
object (masts, demand markers, waypoints, the drone) is owned by a domain
module that re-registers it on load, so the registry rebuilds itself.
Recommended masts (owner `recommend`) are computed *results* and are never
written; node roles are derived from the arsenal and need no block.

- **Never** included: API keys, computed rasters/results, anything from
  outside the user's own inputs. Serialization is whitelist-only — unknown
  keys on the gathered state cannot leak into the file (the negative test
  feeds results + a key and asserts absence). The file contains the user's
  coordinates — say so in the save dialog (OPSEC is the user's call, the
  file stays local).
- `version` gates parsing: unknown major → clear error + "newer app?" hint;
  v1 parser tolerates missing optional blocks (forward-compatible adds).
- On load: replace current state (confirm if unsaved work exists), then run
  the normal analyse path once — same code as the user pressing Analyse.

### Entry points

- **Save**: ⌘S / Ctrl-S, a Save action in the Output group and in the ⌘K
  palette. Filename suggestion `mission-YYYYMMDD-HHmm.groundlink.json`.
- **Load**: the existing import button + drag-drop (extend the accept list;
  `.groundlink.json` routes to mission load, KML/GeoJSON keep their current
  import path), the empty state (below), and a palette action.
- **Unsaved-changes marker**: reuse the M20 dirty flag — title bar dot +
  confirm on load/clear when dirty.

## B. Focus mode — fullscreen sections

### Mechanics (one implementation for all sections)

- Every section header gets an **expand** button (⤢, `aria-label`
  "Open fullscreen") next to the chevron; ⌘K gains "Focus: <section>".
- Opening focus: the left panel collapses to the icon strip, and a
  **focus surface** fills the entire area right of the strip (map keeps
  living underneath — `map.resize()` on enter/exit, no teardown). The strip
  highlights the focused module; clicking another strip icon switches focus
  to that section; the map icon (or Esc / ⤡) returns to the map.
- The section's existing DOM node is **portalled** into the focus surface
  (moved, not cloned — one source of truth, all wiring intact) and moved
  back on close. Pure state machine `src/ui/focus.js` (TDD): enter/switch/
  exit, portal bookkeeping, restore scroll position.
- Focus surface chrome: header row (module icon, group / name breadcrumb,
  status badge from M20, module actions, close ⤡), body grid, footer hint.
  Focus trap inside the surface; Esc exits; `role="region"` + label.

### Layout tiers

1. **Generic (every section, this milestone):** the portalled form renders
   in a wide responsive grid (`.focus-body` 2–3 columns,
   `repeat(auto-fit, minmax(340px, 1fr))`), disclosure blocks open by
   default, full-width tables. CSS-only enrichment — the form simply gets
   room to breathe.
2. **Dashboard layouts (this milestone, data already exists):**
   - **Objects** — sortable full table (name, kind, grid ref, freq, power,
     height, status), row selection synced with the map selection, bulk
     delete, the M19 context menu on rows.
   - **Power & endurance** — per the agreed mock: four metric cards
     (network endurance, batteries, solar, tightest node), per-node
     endurance table with capacity bars (existing coverage-spectrum
     tokens), timings-plan and ATAK/powerbank side cards.
3. **Later milestones:** PACE as document view, radios as card grid —
   note in roadmap, not built now.

## C. Empty state

On a fresh session (no AOI, no objects, nothing imported): a centred card
over the map — "Begin je planning" with three actions: **Draw AOI**,
**Place mast**, **Open mission / import** (file picker accepting
`.groundlink.json` + KML/KMZ/GPX/GeoJSON) and the ⌘K hint. Dismiss ×;
never reappears once anything exists; pure predicate `isEmptyMission(state)`
shared with planstate (TDD).

## D. Undo

- `src/ui/undo.js` (TDD): stack (depth 20) of inverse registry operations
  for **move / rename / delete** (delete restores the full entry).
  ⌘Z / Ctrl-Z; redo ⇧⌘Z. Status-bar toast "Ongedaan gemaakt: Mast Alpha
  verplaatst" pattern reused from the copy toast.
- Undo of an RF-relevant op routes through the same dirty/recompute flow
  (M20 stale pill) — no special casing.

---

## Tests (vitest, pure logic only)

- `mission.test.js` — round-trip serialize→parse equality; version gate;
  missing-optional tolerance; key/result exclusion (serializing a state
  containing results/keys must not emit them); malformed JSON errors.
- `focus.test.js` — state machine: enter/switch/exit transitions, portal
  bookkeeping (node moved exactly once, restored on exit), Esc semantics.
- `undo.test.js` — push/undo/redo ordering, depth cap, delete-restore
  payload, redo invalidation on new op.
- `emptystate.test.js` — predicate truth table.

DOM/interaction verified manually in the browser (standing rule).

## Constraints & non-goals

- No colour/token additions; no new dependencies; no network calls;
  OPSEC as above (file local-only, coordinate warning in the save dialog).
- `localStorage` untouched by the mission file (explicit files only).
- Both themes; keyboard + ARIA per feature; `prefers-reduced-motion`.
- Out of scope: cloud sync/share links, mission-file encryption (ask Keith
  before ever adding), PACE/radios dashboard layouts, autosave.

## Acceptance checklist

- [ ] Save → file downloads; load via drag-drop and via empty state; state
      matches (names, AOI, arsenal, roles, settings); analyse re-runs once;
      a file saved with results/keys present in app state contains neither.
- [ ] Every section expands to focus; forms get the wide grid; Objects and
      Power show their dashboard layouts; strip switches focus; Esc returns
      to the map with panel state restored.
- [ ] Fresh session shows the empty state; any action dismisses it for good.
- [ ] Move/rename/delete each undo and redo correctly, with recompute.
- [ ] `npm test` green; `npm run build` clean; both themes; ≤ 900 px OK
      (focus surface becomes the full viewport; mission file unchanged).
