# M23 fixes — palette typeahead · cellular signal scale · locate button

Three items, each investigated before coding. Two of the three briefs turned
out to describe the symptom correctly but the prescribed fix inaccurately —
the deviations and the evidence are recorded here.

## 1 · Palette place search fires too late

**Symptom (confirmed):** "barduf" → nothing, "bardufoss" → works.

**Investigation:** the geocoder lives in `src/ui/search.js` (palette.js is
the DOM-free ranking core). It already debounces (350 ms) and caps at 5 —
the problem is the *service*, not the wiring. Nominatim's `/search` endpoint
does **no prefix matching** and the brief's "prefix-search endpoint" URL is
that same endpoint: `…/search?q=barduf&format=json&…&addressdetails=1`
returns `[]` (tested). No parameter changes can make Nominatim autocomplete;
its own docs say it is not suited for as-you-type search.

**Fix:** switch the typeahead to **Photon** (`photon.komoot.io/api`) —
komoot's OSM-based geocoder built precisely for prefix autocomplete
("barduf" → Bardufoss lufthavn, …; tested), free, token-free, no SDK (plain
`fetch`, allowed by the existing `connect-src https:` CSP). Brief's UX
parameters kept: **minimum 3 chars, 300 ms debounce**, 5 results, results
render as the user types. Photon's GeoJSON is mapped to the
Nominatim-compatible shape the palette already renders
(`photonToPlaces()`, pure + unit-tested; extent `[w,n,e,s]` →
boundingbox `[s,n,w,e]`). Coordinate queries still never hit the network.

## 2 · Cellular signal-strength raster

**Symptom:** the cellular coverage raster paints one flat colour per network
type instead of the Excellent→None signal heatmap.

**Investigation:** the raster pipeline is **not missing and not broken** —
each network type owns a coverage controller that computes FSPL + Deygout
diffraction over AWS Terrarium terrain in the coverage worker, exactly the
"distance + terrain" model the brief asks to rebuild (only better). What
changed is one line: commit `e4d7d13` ("cellular signal scale") shipped the
heatmap by *removing* the per-type `tint`; commit `ee1a92a` re-introduced
`tint: CELL_TYPE_DEFAULTS[type].color`, silently flattening the scale. Not
an M19/M20 casualty — predates both. No distance-weighted re-implementation
is warranted; restoring the colour scale is the whole fix.

**Fix:** drop the `tint` from the cellular coverage controllers in main.js
so cells colour by signal class again, and add a compact legend to the
cellular panel (Excellent ≥ −75 · Good ≥ −85 · Marginal ≥ −95 dBm, derived
from `thresholdsForSensitivity(−100)`).

**Toggle:** the Show coverage button is now a true on/off toggle
(`aria-pressed`, label flips to "Hide coverage"). Shown → a click hides the
rasters and tower markers via `setVisible(false)` without dropping the
fetched towers; hidden → a click (re)computes and shows them. Clear and
unticking "Show cellular layer" reset the toggle.

**Dots:** the network-type checkbox dots in index.html had hardcoded hex
colours; they now use the same tokens `CELL_TYPE_DEFAULTS` resolves
(`--dim` / `--feat-event` / `--feat-track` / `--s1`), so dots, tower markers
and themes stay in sync.

**Token note:** there are no `--cov-*` tokens in tokens.css — the existing
coverage spectrum tokens are **`--s1…--s5`** (vivid aqua→rose), which the
coverage palette already resolves via `cssVar()`. The legend uses the same
tokens. Network-type colours remain on the tower markers and checkbox dots.
With several types ticked the translucent rasters stack (as `e4d7d13`
shipped); the scale reads best one type at a time.

## 3 · "Show my location" rail button

New `src/ui/locate.js` (`createLocateControl`), button in the right map rail
under the profile tool. Behaviour:

- Click → `navigator.geolocation.getCurrentPosition` → `flyTo` the fix →
  pulsing accent dot (`.locate-dot`, CSS keyframes on `--accent`, honours
  `prefers-reduced-motion`).
- Then `watchPosition` keeps the dot tracking while permission stands; the
  button shows `is-active` + `aria-pressed="true"`; clicking again stops the
  watch and removes the dot.
- Permission denied / no fix / insecure context → toast **"Location not
  available"** via new minimal `src/ui/toast.js` (single `aria-live="polite"`
  chip over the map, auto-hides, design tokens only).
- `aria-label="Show my location"`, native button → keyboard accessible like
  the rest of the rail.

Privacy: the position is used client-side only (map fly-to + marker), never
stored or sent anywhere — consistent with the OPSEC constraint.

## Out of scope

Nominatim reverse-geocoding, locate-accuracy circle, multi-type cellular
compositing (best-server view is on the roadmap).
