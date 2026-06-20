# M43 — Coverage Gap Report

## Goal
Export a printable HTML table of dead zones (uncovered areas) with centroid coordinates, area, estimated radius, and an automated relay recommendation per zone.

## Files
- `src/export/gap-report.js` — `generateGapReport()` + `openGapReport()`
- `src/ui/resultcard.js` — added `onGapReport` callback + "Gap report" button (shown only when dead zones exist)
- `src/main.js` — import + `openCoverageGapReport()` function + `onGapReport` wiring

## Data source
`summarizeCoverage({ ...lastPaint, aoi: aoiMask, thresholds })` — the same call used by the result card. Dead zones come from an 8-connected flood fill over cells below the marginal threshold (class ≥ 3) inside the AOI. Up to 5 largest zones are reported.

Each zone has:
```js
{ centroid: { lat, lng }, areaKm2, cells }
```

## Output format
Print-ready A4 portrait HTML — same blob-URL pattern as `brief.js` (M37) and `freq-plan.js` (M40).

### Sections
1. **Header** — mission name, timestamp, model label, build version.
2. **Summary stats** — coverage %, dead zone count, total uncovered km².
3. **Dead zone table**:
   | # | Centroid (lat, lng) | Area (km²) | Est. radius (km) | Recommendation |
4. **Footer** — OPSEC note (coordinates from local mission file only).

### Relay recommendations (by zone size)
| Area | Recommendation |
|------|---------------|
| < 0.5 km² | Mast height increase or antenna reorientation |
| 0.5–5 km² | Single passive repeater or raised mast |
| 5–25 km² | Static relay or tethered drone |
| > 25 km² | Airborne relay (drone/aerostat) or dedicated repeater site |

## UI trigger
"Gap report" button appears in the result card's action row **only when dead zones exist** (`zones.length > 0`). Opens in a new tab (pop-up fallback: file download).

## Wiring (main.js)
```js
function openCoverageGapReport() {
  // 1. Compute fresh summarizeCoverage() from lastPaint + AOI mask
  // 2. Resolve model label (same logic as showResultCard / openMissionBrief)
  // 3. generateGapReport(...) → openGapReport(html)
}
```

## Follow-up
- Map image inset showing dead zone centroid markers.
- Link each zone row to a KML placemark export.
- Surface via ⌘K palette action "Export gap report".
