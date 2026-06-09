# Dispatch prompt — GroundLink M3 site recommendation

*Paste this entire file as the task prompt into a new Claude Code session inside the GroundLink repo.*

---

## Context

You are working in the **GroundLink Comms Coverage Planner** repo. Read `CLAUDE.md` first (project guide, constraints, conventions). The app is a Vite + vanilla JS single-page app with MapLibre GL JS. M1 (shell + map) and M2 (terrain-aware coverage, drone relay) are complete. This task has two parts: fix four pre-existing bugs, then implement M3 site recommendation.

**Hard constraints (non-negotiable):**
- Never commit real site coordinates. Client-side only; no data leaves the browser (OPSEC).
- No secrets in source; tokens are user-entered at runtime.
- No `localStorage`/`sessionStorage`.
- Run `npm run dev` and verify in a real browser before declaring any step done.

---

## Part 1 — Fix these four bugs first

Work through them in order. Commit each fix separately.

### Fix 1 — Esri National Geographic is in the wrong basemap list

**File:** `src/map/basemaps.js`

`BASEMAP_VARIANTS.imagery` currently includes `esri-natgeo` (Esri National Geographic). National Geographic is a cartographic reference map, not satellite imagery — it does not belong in the Imagery category.

**Change:** move the `esri-natgeo` entry from `BASEMAP_VARIANTS.imagery` to `BASEMAP_VARIANTS.topo` (append at the end of the topo array). No other changes to the basemap logic.

Verify: after the move, right-clicking "Topo" should show NatGeo in the dropdown; right-clicking "Imagery" should not.

---

### Fix 2 — Coverage raster is clipped to the AOI bounding box instead of the signal range

**Files:** `src/main.js` (where `runCoverage()` calls `coverage.compute()`), `src/coverage/coverage.js` (where `compute()` passes bounds to the worker).

**Problem:** `runCoverage()` passes `area.bounds` (the AOI bounding box) as the compute bounds. The worker fills this rectangle, producing a square-edged raster regardless of signal range. For a 15 km radius AOI at VHF the signal may naturally die well before the AOI edge — or extend beyond it from a high mast — but the raster is always clipped to the bbox.

**Fix:** derive the compute bounds from the maximum signal range, centred on the TX position, not from the AOI bbox.

Compute max range from physics (no DEM yet, conservative FSPL):
```js
// In coverage.js or a shared utility:
function maxRangeM(params) {
  // FSPL(d, f) = received - eirp + floor => solve for d
  // 20*log10(d) = eirp + rxGain - floor - 20*log10(f_Hz) - 20*log10(4π/c)
  const { eirpDbm, freqMHz, rxGainDbi = 0, floorDbm = -120 } = params;
  const LIGHT = 299792458;
  const log10 = (x) => Math.log(x) / Math.LN10;
  const budget = eirpDbm + rxGainDbi - floorDbm
    - 20 * log10(freqMHz * 1e6)
    - 20 * log10((4 * Math.PI) / LIGHT);
  return Math.pow(10, budget / 20); // metres
}
```

Build a square bounds centred on `tx` with half-side = `maxRangeM(params)` (convert to degrees at the tx latitude). Pass this to `coverage.compute()` instead of `area.bounds`. The existing `COVERAGE_CLASS.TRANSPARENT` (below-floor cells) already gives the raster a natural round edge — no additional masking needed.

Keep the AOI bounds as the minimum: if `maxRangeM` is smaller than the AOI, expand to at least the AOI bbox so the user always sees the whole AOI.

Verify: at 150 MHz / 5 W with a flat AOI, the raster edge should be roughly circular, not rectangular.

---

### Fix 3 — Stale `AUTO_ZOOM_THRESHOLD` export in basemaps.js

**File:** `src/map/basemaps.js`

Zoom-based auto-switching between Imagery and Topo was explicitly removed at the user's request. The export `AUTO_ZOOM_THRESHOLD = 10` and the comment on line 13 ("Zoom-based auto-selection: imagery below AUTO_ZOOM, topo at or above") are dead code.

**Change:**
1. Delete the `export const AUTO_ZOOM_THRESHOLD = 10;` line.
2. Remove or rewrite the stale comment in the file header so it no longer mentions auto-selection.
3. Verify no other file imports `AUTO_ZOOM_THRESHOLD` (there shouldn't be — it was cleaned from `main.js` already; `grep` to confirm).

---

### Fix 4 — Coverage stats denominator counts all bbox cells, not in-AOI cells

**Files:** `src/coverage/coverage.js` (painter), `src/workers/coverage.worker.js` (compute).

**Problem:** `lastStats.coveredFrac = covered / classes.length`. `classes.length = cols × rows` — all cells in the bbox rectangle. For a circular AOI about 21% of those cells are in the four corners (outside the circle), silently understating the coverage fraction. "85% coverage" actually means 85% of the bbox, not 85% of the drawn AOI.

**Fix:** pass the AOI shape into the worker alongside `bounds`, so the worker can track `inAoi` and `coveredInAoi` separately. Extend the worker `done` message:

```
// Worker: coverage.worker.js — add to the compute message input:
// aoi: { type, center:{lat,lng}, radiusM, ring } — same shape used by recommend.worker

// Worker output: add inAoi, coveredInAoi, coveredFracAoi to the done message
{ type:'done', id, cols, rows, classes,
  terrain, clutter,
  totalCells: cols*rows,
  inAoi: <number>,
  coveredInAoi: <number>,
  coveredFracAoi: <number>
}
```

In the worker inner loop, check `inAoi(aoi, lng, lat)` per cell (reuse the same `inAoi` helper you'll write for the recommend worker — or inline a simple version here). Cells outside the AOI are still computed and painted (the user sees signal propagating beyond the circle, which is correct), but only in-AOI cells count toward the stats denominator.

Update `lastStats` in `coverage.js` to include `coveredFracAoi`. Update the UI text that shows coverage % to use `coveredFracAoi` when an AOI shape is available.

The `aoi` argument is optional (backward compat for drone relay calls that pass `bounds` without shape). When absent, behaviour is unchanged (`coveredFrac` = bbox fraction as before).

---

## Part 2 — Implement M3 site recommendation

Read `docs/M3-site-recommendation.md` fully before writing any code. It is the authoritative spec and includes exact function signatures, worker message formats, edge cases, and acceptance criteria.

**High-level implementation order:**

### 2a. Extract `buildProfile` to a shared module

Create `src/workers/profile.js` with the extracted `buildProfile` function (exact signature in the spec). Remove the local copy from `coverage.worker.js` and import from `./profile.js`. Run a coverage compute to confirm the refactor is transparent.

### 2b. Extend `coverage.worker.js` for multi-tx

Add optional `txs: [{lat, lng, txHeightM}]` to the worker message. When present, per cell compute max received dBm across all txs, then classify. Single-`tx` path unchanged. Test with `txs` = `[single site]` produces the same result as the existing `tx` path.

### 2c. Build `src/workers/recommend.worker.js`

Steps: demand grid (AOI-masked) → DEM fetch → candidate generation (local maxima) → point-to-point scoring → greedy set-cover → `done` message. Follow the spec exactly for message format and progress reporting. Use imports from `src/coverage/model.js`, `./profile.js`, `./dem.js`, `./worldcover.js`.

### 2d. Build `src/recommend/recommend.js`

Main-thread controller: spawns the worker, owns the draggable numbered markers, owns the site-list DOM, calls `coverage.compute()` with `txs` after greedy and after each drag (debounced 300 ms). Expose `recommend(area, params, opts)` and `clear()`.

### 2e. Wire into `index.html` + `src/main.js`

Add the "Site recommendation" panel section (HTML in spec). Import and initialise `createRecommendController`. Wire `recommendBtn`, `clearSitesBtn`. Disable `recommendBtn` when no AOI (keep it in sync with the existing AOI `onChange` handler). Expose `window.__gl.recommender` in DEV mode.

### 2f. CSS

Add `.site-marker` and `.site-list` styles to `styles/components.css`. Follow design tokens: `--accent` fill, tabular figures, hover state. Do not add new colour variables — reuse the existing signal-scale and feature tokens.

---

## Commit plan

```
fix(basemap): move esri-natgeo from imagery to topo variants
fix(coverage): derive compute bounds from signal range, not AOI bbox
fix(basemap): remove stale AUTO_ZOOM_THRESHOLD export and comment
fix(coverage): use in-AOI cell count as stats denominator
feat(profile): extract buildProfile to shared src/workers/profile.js
feat(coverage-worker): add multi-tx txs[] support (max-dBm per cell)
feat(recommend-worker): demand grid, DEM peaks, scoring, greedy set-cover
feat(recommend): main-thread controller, draggable markers, site list
feat(ui): M3 site recommendation panel section, HTML + CSS
```

## Verification

After Part 2 is complete, run through the acceptance criteria in `docs/M3-site-recommendation.md` (8 scenarios). Confirm existing coverage and drone relay tests still pass. Run `npm run build` — zero errors before any commit to main.
