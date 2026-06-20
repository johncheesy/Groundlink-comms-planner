# M42 — Drone Height Optimizer

## Goal
Given a placed drone relay, sample coverage at 6 altitudes AGL and find the one that maximises coverage fraction in the AOI. Renders the winner to the map and applies it to the drone's altitude slider.

## Files
- `src/analysis/drone-optimizer.js` — pure async function `optimizeDroneHeight()`
- `index.html` — "Optimize altitude" button (`#optimizeDroneHeight`) + `#droneOptPanel` in `#dronePanel`
- `styles/components.css` — `.drone-opt-*` bar chart styles
- `src/main.js` — import + click handler

## Algorithm

```
altitudes = [50, 100, 150, 200, 300, 500]  // m AGL

for each altM in altitudes:
  result = coverage.computeAsync(bounds, dronePos, { ...baseParams, txHeightM: altM }, { render: false })
  record { altM, coveredFrac }

best = argmax(coveredFrac)
coverage.computeAsync(bounds, dronePos, { ...baseParams, txHeightM: best.altM }, { render: true })
drone.setAltitude(best.altM)
```

Uses `coveredFracAoi` (within the AOI boundary) if available, else `coveredFrac` (whole raster). All intermediate renders use `render: false` to avoid flickering; only the winner is painted.

## UI

1. Button "Optimize altitude" appears in the drone panel (below "Compute relay coverage").
2. While running: inline progress text "Testing N/6 altitudes…" + status bar update.
3. After completion: **bar chart** (CSS `div`s, height proportional to coverage%) with:
   - Azure bars for all altitudes
   - Teal bar for the best altitude
   - Coverage % label above each bar
   - Altitude (m) label below each bar
4. Result line: "Optimal: 200 m AGL — 78% coverage"
5. Altitude slider (`#droneAlt`) is programmatically moved to the best value.

## Bounds resolution
Uses the AOI bounds if an AOI is set; falls back to a 30 km circle around the drone position (same as `computeRelay()`).

## Performance
6 sequential `computeAsync()` calls (no parallelism, avoids worker contention). At typical grid sizes (200×200) each call takes ~1–3 s, so total runtime is ~6–18 s. Progress is reported after each altitude.

## Follow-up
- Finer altitude sweep (e.g. 10 m steps near the optimum).
- Support `render: false` result caching to avoid re-running the best altitude.
- Expose as a ⌘K palette action.
