# M52 — Ops workspace

**Status:** built 23 Oct 2026 (phases 1–6, 0.10.0-beta) · decision: Option
C "Ops" from the 23 Oct GUI options review, polished against an external
reference dashboard (see §2) · follows the 22 Oct readability pass

**Implementation notes.** `src/ui/ops-shell.js` (shell, flyouts, phone tab
bar and sheets), `src/ui/ops-rail.js` (tiles + events, pure `tileModel()`),
`src/ui/ops-drawer.js` (tabs, pure row builders). The Ops workspace is the
default; `?ws=classic` brings the M19/M20 toolbar-and-panel layout back for
one beta. The classic markup is *not* deleted: the sections still live in
the panel DOM and the flyouts move them in and out, which is what keeps
every handler working without a rewrite. Deleting it means re-homing the
sections (v1.0). Not built from the spec: the spectrum channel strip on
tile 9 (count and tone only) and the rain-fade note on tile 10 (the satcom
panel has it). Events are per session, as specced.

## 1. Problem

The workspace grew one section at a time. Today the planner reaches the
same thing five ways (toolbar icon, left-panel section, map rail flyout,
⌘K, context menu), results are spread over a result card, a map key, a
stale pill, an ops flyout, a link list and popups, and the product review
(21 Oct) found that the confident numbers are not read together: readiness
100 with nothing analysed, "100 % covered" with default radios.

Option C puts the **state of the mission** on one rail that is always
visible, cuts the top bar to what starts and finishes a run, and keeps every
editor as a flyout over the map. The map stays the biggest thing on screen.

## 2. What we take from the reference, and what we do not

An external mock ("RF Planner", laptop / tablet / EUD) was used as the bar
for clarity and finish. Its structure is close to Option C. Taken over:

| Take | Why |
|---|---|
| Three form factors designed as one hierarchy (laptop 16:10, tablet 4:3, phone/EUD 6") | Today the phone layout is a patch on the desktop one |
| Status tiles: icon · label · one big tabular number, equal height, one column | Glanceable; the ops dashboard today is prose and pills |
| One **data drawer** at the bottom with tabs (Sites · Links · Gaps · Radios) and sortable columns with status dots | Replaces the result card, link list, gap table and objects list |
| An **Events** feed with a time stamp per entry | Stale plan, link lost, conflict found, satcom fade: today these are toasts that vanish |
| Mission selector and online/offline state in the top bar | Mission file + PWA already exist, they are just not shown |
| Scale bar, compass and layer toggle directly on the map; signal key as one compact card | Already partly there; make it consistent |
| One icon set with one stroke width | Today: mixed custom symbols |

Not taken, on purpose:

- **Navy surfaces, Inter/Roboto.** The tokens, Sora and Hanken Grotesk
  stay. The dark theme already gives the "console" look.
- **Green → yellow → red coverage.** The aqua → rose spectrum with "no
  coverage unpainted" (U1) stays: it reads on satellite imagery and does
  not fail for red–green colour blindness.
- **Live spectrum waterfall, "active links", "2 h ago" telemetry.** The
  app has no live feed (that is M62). Nothing on the rail may imply one.
  The honest counterparts are the deconfliction channel strip (M39) and
  the path-profile margin per link (M14/M50).
- **Link time-series chart.** No time dimension yet (M61).

## 3. Layout

### 3.1 Desktop (≥ 1100 px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◉ GroundLink  │ Utrecht relay test ▾ · saved 14:02 │  ⌘K  │ Open │ ▶ Run │ Export ▾ │ ◐ │   52 px
├────┬─────────────────────────────────────────────────────────┬───────────┤
│ 46 │                                                         │  Status   │
│ px │                      MAP                                │  rail     │
│tool│   key ─┐                              compass / zoom ─┐ │  272 px   │
│strip   flyout opens here, over the map                       │           │
│    │                                                         │           │
│    ├─────────────────────────────────────────────────────────┤           │
│    │ ▸ Sites 3 · Links 3 · Gaps 3 · Radios 4     (drawer)    │           │
├────┴─────────────────────────────────────────────────────────┴───────────┤
│ status bar                                                               │ 28 px
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar** (52 px): brand · mission name as a selector (recent mission
  files, *New*, *Open…*, *Save* ⌘S) with the saved/unsaved state · ⌘K ·
  Open/import · **Run** · **Export ▾** (brief, freq plan, gap report, KMZ,
  GeoTIFF, GeoJSON, CivTAK, mission file) · theme. The 13 module icons,
  the 3-step stepper and the intel chip go.
- **Tool strip** (46 px, left): one icon per editor, vertically: Area ·
  Sites · Radios · Coverage · Drone · Cellular · Satcom · HF · Teams ·
  PACE · Power · Calibration · Layers/Data. One opens at a time as a
  **flyout** (360 px, anchored to its icon, over the map). Esc or a click
  on the map closes it. The icon shows a dot in the plan colour when its
  section has input (teal) or needs attention (amber).
- **Status rail** (272 px, right, always visible): the tiles in §4. Scrolls
  if taller than the viewport; the first four tiles never scroll away.
- **Data drawer** (bottom of the map area): collapsed to a 36 px strip with
  the tab names and counts; opens to 40 % of the map height, drag to
  resize, double-click the handle for 70 %. Tabs in §5.
- **Map overlays**: signal key top-left (collapsible to a 24 px pill),
  stale-plan pill top-centre, zoom/compass/locate/3D bottom-right, scale
  bar bottom-left, map notice (M-notice fix of 23 Oct) top-left under the
  key.
- **Status bar** (28 px): unchanged content, plus online/offline from the
  service worker and the cell count of the last run.

### 3.2 Tablet (760–1099 px)

Top bar and tool strip as on desktop. The status rail becomes a
**horizontal tile row** above the drawer (tiles 148 px wide, scroll
sideways). The drawer keeps its tabs. Flyouts are 320 px.

### 3.3 Phone (< 760 px)

- Top bar: brand mark, mission name, Run; everything else in ⌘K/More.
- Tool strip becomes the bottom tab bar: Map · Plan · Status · Data · More
  (44 px targets). *Plan* lists the editors as a full-height sheet; an
  editor opens as a sheet over the map with a 48 px handle.
- *Status* is the rail as a sheet; *Data* is the drawer as a sheet.
- On the map: key, stale pill, zoom/locate. Nothing else.

## 4. Status rail tiles

Every tile reads existing state; none computes anything new. Order is
fixed (most decisive first). A tile with no data shows its label and a
`—` with a one-line reason ("no run yet", "enable cellular"), never a 0 or
a 100.

| # | Tile | Number | Source | Secondary line / colour |
|---|---|---|---|---|
| 1 | Coverage | `71 %` covered | `coverageSummary.coveredPct` | model badge (E3b) + cell size; amber when stale |
| 2 | Readiness | `68` gauge 0–100 | `readiness.js` score | six-dimension dots; **grey with "not analysed" until coverage and PACE exist** (review F2) |
| 3 | Weakest link | `+6 dB` | `computeLinkMargins()` min | link name; teal ≥ 10, amber < 10, rose < 0 |
| 4 | Dead zones | `3` · `4.5 km²` | gap report (M43) | largest gap name; click pans to it |
| 5 | PACE | `P A C E` four boxes | `buildPace()` + `legFilled()` | filled = teal, "not carried" = amber, empty = outline |
| 6 | Drone relay | `100 m AGL` | `droneController.state()` | `+12 pts vs ground`; hidden until a drone is placed |
| 7 | Endurance | `6.5 h` | power snapshot (M8) | limiting node |
| 8 | Cellular | `KPN 4G` best net | M22 best-network | `12 towers`; hidden until the layer is on |
| 9 | Spectrum | `2 conflicts` | deconfliction (M39) | channel strip: used channels as ticks, conflicts amber |
| 10 | Satcom | `Ka: −3 dB rain` | M44 fade | best GEO look angle |
| 11 | Teams | `4 teams · 0.6 E` | teams/Erlang (M13) | busiest net |

Below the tiles: the **Events** list (last 8, newest first, `hh:mm`):
stale plan, coverage finished, link check result, conflict found, satcom
fade warning, mission saved/loaded, data source fell back (basemap, clutter,
terrain). Each entry has one action where it makes sense (*Recompute*,
*Show*, *Profile*). Events are in-memory per session, not saved.

Clicking a tile opens the matching flyout (Coverage → Coverage editor,
PACE → PACE, Spectrum → Deconfliction). The ops dashboard flyout (M36) is
retired; its content is the rail.

## 5. Data drawer tabs

| Tab | Columns | Row click | Replaces |
|---|---|---|---|
| Sites | name · type (site/relay/recommended) · height · power · EIRP · aimed az · links · status dot | pan + select; context menu as today | Objects list, site popups |
| Links | name · A → B · length · band · margin · verdict (ok/tight/blocked/no close) · *Profile* | opens path profile for that link | Mission-panel link list |
| Gaps | # · area km² · nearest site · suggested relay (M43) | pans to the gap | gap report table |
| Radios | model · band · power · ant dBi · loss dB · role · carried by | opens the radio editor | arsenal table |

Every column sorts; numbers are tabular; status is a dot plus a word, never
a dot alone. The result card's assumptions line ("2 W · 450 MHz · rx 1.5 m
· clutter on · loss 3 dB") becomes the drawer's header strip, always
visible even when the drawer is collapsed.

## 6. Finish rules (the "gelikt" part)

These are what make the reference read as finished. They apply to every
new component and are checked in review:

1. **One icon set.** Every icon is a 24-grid outline, 1.75 px stroke,
   round caps, from one sprite in `index.html`. Replace the mixed symbols;
   no filled icons except the Run triangle and status dots.
2. **Four type sizes only** in chrome: 11.5 (labels, status bar), 12.5
   (body, table cells), 14 (section titles, tile labels), 22 (tile
   numbers, Sora). Nothing below 11.5 px (U6).
3. **Tile grammar**: icon 18 px · label 12.5 dim · number 22 Sora tabular ·
   secondary 11.5. Height 64 px. Same padding (12 × 14) everywhere.
4. **Spacing scale** 4 · 8 · 12 · 16 · 24 only. Radius 11 px for cards,
   999 for pills, 8 for inputs.
5. **Status colours by meaning only**: teal ok / amber attention / rose
   failing / grey no data. Never a colour for decoration.
6. **One shadow** (`--shadow`) for anything that floats; flat borders for
   anything docked.
7. **No empty-state surprises**: a tile, tab or flyout without data says
   why and what to do, in one line.
8. **Motion**: flyouts and the drawer slide 160 ms ease-out; nothing else
   animates. `prefers-reduced-motion` disables it.
9. **Contrast** ≥ 4.5:1 for all text in both themes (U4/U5 held).
10. **Density stays available**: the flyouts keep every field the panels
    have today behind *Advanced*; nothing is removed, only moved.

## 7. Mapping from today's DOM

| Today | Becomes |
|---|---|
| `#toolbar` modules, stepper, intel chip | removed; tool strip + rail |
| `#toolbarRight` Open / Run / Brief | top bar Open / Run / Export ▾ |
| left panel groups + 14 sections | 13 flyouts, same section markup moved into `.flyout` hosts (sections keep their ids so handlers survive) |
| Objects tab | Sites tab in the drawer |
| `.result-card` | drawer header strip + Coverage tile |
| map key, stale pill, map notice | unchanged, re-anchored |
| map rail flyouts (basemap, view, data, import, profile) | basemap/view/3D stay on the map; data → Layers flyout; import → top bar; profile → Links tab + context menu |
| `dash-ops.js` flyout (M36) | retired; `readiness.js`, `dash-ops.js` snapshot builder reused by the rail |
| `src/ui/topology.js` (M41) | opens from the Links tab header |
| ⌘K palette | unchanged, gains "Open <flyout>" entries |

## 8. Build plan (phases, each shippable)

1. **Shell** — new top bar, tool strip, rail host, drawer host; the old
   left panel mounts inside flyouts unchanged. Feature flag
   `?ws=ops` until phase 3. 4–6 files.
2. **Rail** — tiles 1–5 and Events from existing state; readiness greyed
   until analysed. `src/ui/rail.js`, `rail.test.js` (pure `tileModel()`).
3. **Drawer** — Sites and Links tabs, drawer header strip, result card
   retired. `src/ui/drawer.js`.
4. **Rest of the rail + tabs** — tiles 6–11, Gaps, Radios; ops flyout
   retired; icon sprite unified.
5. **Tablet + phone** — tile row, bottom tab bar, sheets. Phone test on a
   real device (open item from the 22 Oct retest).
6. **Flag removed**, old shell deleted, `docs/M19`/`M20` marked
   superseded, screenshots in `docs/img/`.

## 9. Tests

- `tileModel(snapshot)`: no run → every tile `—` with a reason; stale run →
  Coverage amber; readiness grey until coverage + PACE; weakest link picks
  the min and colours by threshold; PACE boxes from `legFilled`; hidden
  tiles for absent drone/cellular.
- `events`: cap at 8, newest first, one entry per stale transition.
- Drawer: sort per column, row click selects the registry object.
- Manual, per phase: the three viewports, both themes, keyboard round-trip
  (tool strip → flyout → map → rail → drawer), contrast scan.

## 10. Out of scope

Live telemetry (M62), time dimension (M61), 3D masts (M51), new analyses.
