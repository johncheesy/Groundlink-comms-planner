# User test — UI and map readability (22 Oct 2026)

Branch `feat/online-round-2` (PRs #32–#34), dev server, built-in browser at
1280×800, light and dark, plus a phone viewport. Focus requested: does the UI
work, and is it easy to see — including the maps.

## How it was run

Three roles, scripted through the app with screenshots at each step, plus an
automated contrast and text-size scan of every visible label (WCAG 2.1 AA:
4.5:1 for normal text, 3:1 for large).

| Role | Path |
|---|---|
| New user | Open the app, first screen, toolbar, empty state |
| Planner | Three masts around Utrecht, 450 MHz, clutter on, FSPL then P.1812 at 2 W; Quality, Best server and Interference views; result card |
| Field user | Same mission in dark mode; phone viewport |

Caveat: the phone check is partly unreliable here. The emulated window
reported 475 px wide while the layout was 375 px, so only findings that do not
depend on the exact width are listed.

## What works well

- The **Interference view** reads best of all: it paints only where there is
  usable signal, so the photo stays visible elsewhere and the problem areas
  stand out.
- **Best-server zones** are clearly distinct hues on the satellite image.
- **Beam wedges** for aimed antennas are visible and point the right way.
- **Result card** gives the key numbers (covered %, dead zones, weakest link,
  model and assumptions) in one place.
- Light theme side panel text is mostly readable; the panel structure (Mission,
  Area of interest, Analysis…) is clear.

## Findings

Severity: **S1** hides information or blocks reading, **S2** hard to read or
misleading, **S3** polish.

| ID | Sev | Where | Finding |
|---|---|---|---|
| U1 | S1 | Map, Quality view | "No coverage" is painted the strongest colour (rose). In a typical run it covers about two-thirds of the map, hides the photo, and draws the eye to where there is nothing. The interference view shows the better pattern: leave areas without usable signal unpainted or very light. |
| U2 | S1 | Map, Quality view | At the default 70% opacity the raster hides roads, towns and water under a flat wash (FSPL run: one teal sheet). You lose your place. |
| U3 | S1 | Map | The satellite basemap has no place names or roads, and no label overlay exists. Orientation depends on recognising the photo. |
| U4 | S1 | Dark theme | The **Run** button is white text on bright teal: 1.59:1. Nearly unreadable. It should use `--accent-ink`. |
| U5 | S2 | Whole UI | The `--faint` text colour fails contrast: 2.77:1 in light, 3.7–3.9:1 in dark. 22 visible items in light, 27 in dark: toolbar group names, section hints, status-bar labels, stepper numbers, unit suffixes (MHz, W, °), satcom details. |
| U6 | S2 | Whole UI | 42 visible text items are below 12 px, down to 9 px (BETA badge, stepper numbers 9.5 px, satcom rows 10 px). |
| U7 | S2 | Map | No colour key on the map. The signal scale is a section further down the side panel, so reading the colours means scrolling away from them. |
| U8 | S2 | Map, Best server | The zone map paints every cell above the floor, including the two-thirds with no usable signal in the same run. It looks fully covered. |
| U9 | S2 | Map, Best server | Which zone belongs to which mast is only in the side-panel legend; all masts look the same on the map and carry no name. |
| U10 | S2 | Map | Mast markers are 16 px dark-outlined squares without labels; on teal coverage they barely stand out. |
| U11 | S2 | Result card | The card is about 380×300 px over the map and hid one of the three masts. |
| U12 | S2 | Map edge | The raster ends in a hard rectangle where the compute window stops. |
| U13 | S2 | Phone | The beta card collapses to 188 px with a 67 px text column (1–3 words per line) and lands on top of the start dialog. |
| U14 | S2 | Phone | 16 visible tap targets are 30×28 px (panel group buttons), below the 44 px guideline. |
| U15 | S3 | First load | The map is black for 2–4 s while imagery loads, with no loading hint. |
| U16 | S3 | First load | The beta banner and the start dialog show at the same time and both cover the map. |
| U17 | S3 | Status bar | After switching from Interference back to Quality the status still says "Interference — C/I…". |
| U18 | S3 | Coverage panel | Orange (poor) and rose (none) are hard to tell apart on the photo. |

## Recommended fixes, in order

1. **U1, U2, U8, U18 — one map change:** leave "none" unpainted by default
   (optional toggle to show it), paint best-server zones only where the signal
   is usable, and lower the default opacity to about 55%. Check the four
   remaining coverage colours against imagery with the palette validator.
2. **U4, U5, U6 — contrast and size:** darken `--faint` until it passes 4.5:1
   on its surfaces in both themes, use `--accent-ink` on accent buttons, and
   set a 12 px floor for text (11 px only for badges).
3. **U3 — labels:** an optional place-name and road overlay above the
   satellite layer (keyless raster labels, e.g. Carto "only labels" or Esri
   reference), on by default.
4. **U7, U9, U10 — map key and markers:** a compact colour key in a map
   corner for the active view; mast markers with a name label, larger, in the
   zone colour in best-server view.
5. **U11, U16, U15:** a smaller result card that docks to a corner and can be
   collapsed; show the beta banner only after the start dialog is closed; a
   short loading hint while the first imagery arrives.
6. **U13, U14:** beta card stacks vertically on narrow screens; 44 px tap
   targets on touch devices.
7. **U17, U12:** status text follows the active view; fade the raster edge.

---

## Retest after the fixes (22 Oct 2026, branch `feat/ui-readability`)

Same roles and mission (three sites around Utrecht, 450 MHz, P.1812 with
clutter), light, dark, and a real 375 px layout (the app in a 375 px iframe;
the viewport emulation misreported widths). The contrast scan was corrected to
read `color-mix()` colours, which the first scan missed.

| ID | Result | How it was checked |
|---|---|---|
| U1 | Fixed — no-coverage is unpainted by default ("Show no-coverage area" brings it back); legend says "not painted". | Screenshot: photo visible outside usable signal |
| U2 | Fixed — default opacity 55%; roads and place names readable through and above the raster. | Screenshot |
| U3 | Fixed — Esri place names (above the raster) and roads (under it) on satellite maps, toggle in the Imagery menu. | Layer order checked; screenshot |
| U4 | Fixed — Run button dark ink on teal, 10.8:1. | Computed colours |
| U5 | Fixed — 0 contrast failures in light and in dark with coverage, key and result card on screen (was 22 / 27). Also fixed on the way: teal text on grey (4.0–4.2:1), coloured badges (2.5–3.5:1), active tabs. | Scan |
| U6 | Fixed — 0 text under 11 px; normal text at least 12 px. | Scan |
| U7 | Fixed — colour key on the map for each view. | Screenshot |
| U8 | Fixed — best-server zones only where the signal is usable. | Screenshot, test |
| U9 | Fixed — sites take their zone colour in best-server view; key names the zones. | Computed marker colours |
| U10 | Fixed — 20 px sites with a light ring and a name label. | Screenshot |
| U11 | Fixed — card docked bottom-right, 320 px, foldable to 320×64; folded by default on phones. | Measured |
| U12 | Fixed — soft edge on screen (exports stay crisp). | Screenshot, test |
| U13 | Fixed — beta card spans the map width minus 24 px and wraps. | 375 px layout |
| U14 | Fixed for touch screens — 44 px minimum via `pointer: coarse`. | CSS; not measurable in this browser (no touch emulation in the iframe) |
| U15 | Fixed — "Loading map imagery…" until the first idle. | Screenshot |
| U16 | Fixed — the beta notice waits for the start card. | DOM check |
| U17 | Fixed — status follows the view. | DOM check |
| U18 | Resolved by U1 — the rose band is hidden by default. | — |

New problems found during the retest, fixed in the same branch:

- **Phone width:** the page was 418–476 px wide on a 375 px screen (header
  module groups, a `1fr` grid column growing to the header's minimum width,
  and the status bar build number). Now 375 px before and after a run.
- **Phone overlays:** the start card sat under the map rail; the attribution
  ran behind the menu button.

Still open: a check on a real phone (touch sizes, iOS Safari); the "poor" band
(−103 to −110 dBm) can still cover a large area at low power — it is shown on
purpose as the weak-signal warning.
