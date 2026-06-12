# Fix — cellular signal scale saturation (+ raster render race)

*June 2026. Follow-up to M9/M22/M23. Files: `src/connectivity/cellular.js`,
`src/coverage/coverage.js`, `index.html` legend.*

## Symptom

"The cellular coverage raster stopped rendering after E1/E2/M24 — tower
markers appear but no Excellent→None colour scale."

## Investigation (what it actually was)

Reproduced at Bardufoss, Norway (69.06 N 18.54 E, 8 km radius AOI, 12 OSM LTE
towers, terrain on). The raster **did** render — but 38 075 of 38 102 in-AOI
cells classified *excellent*, 27 *good*, zero anything else: a flat teal disc,
visually indistinguishable from the pre-M23 "flat tint" bug.

Ruled out a code regression by running the identical scenario on a worktree at
`0777c31` (pre-E2/E1/M24): **pixel-identical output** (same 38 075/27 class
counts). The compute path through E1's sampler seam, E2's engine branch and
M24's best-server collection reproduces the old FSPL+Deygout numbers exactly.

Root cause is parameterisation, present since the signal scale shipped
(`e4d7d13`): the macro default modelled **wideband sector EIRP (+58 dBm)** but
classified it against a scale whose *excellent* bar sat at −75 dBm
(sensitivity −100 + 25). At AOI scale (a few km) free-space level is ≈ −40 to
−55 dBm; even 30 dB of Deygout knife-edge loss cannot leave class 0. The
gradient only ever appeared on viewport-wide computes where distance reaches
tens of km. The scale was mathematically unreachable in the advertised
"draw an AOI" flow — on any terrain.

## Fix 1 — classify the reference signal, not the wideband carrier

What a device reports (and what coverage bars mean) is RSRP-style
reference-signal level. For a 10 MHz LTE macro, per-reference-signal EIRP is
≈ 58 − 10·log₁₀(600 RE) ≈ **+30 dBm**; the edge-of-service RSRP is ≈
**−110 dBm**. `CELL_DEFAULTS` now carries those two numbers; the +25/+15/+5
ladder in `thresholdsForSensitivity()` then lands exactly on the
operator-conventional bands:

| class | RSRP |
|---|---|
| Excellent | ≥ −85 dBm |
| Good | ≥ −95 dBm |
| Marginal | ≥ −105 dBm |
| None (edge) | ≥ −110 dBm |
| floor (transparent below) | −120 dBm |

Net effect: the same terrain shadow that used to move a cell −50 → −80 dBm
(invisible, still class 0) now moves it across two classes. Verified at
Bardufoss: the AOI shows the full spectrum with terrain shadows behind ridges
(screenshot in PR).

Honesty note (matches M9's): one omni number per tower, no sectorisation/
downtilt/load — planning-grade, not an operator map. GSM/UMTS measure
RSSI/RSCP rather than RSRP; the single scale is a deliberate simplification.

## Fix 2 — raster add guarded against the style-load race

`renderRaster()` called `map.addSource`/`map.addLayer` bare. Both throw before
the style's first `load` event, so a compute landing during a slow style load
silently dropped the raster — while tower markers appeared, because M22 gave
*them* a try/catch + retry. That is the one path that genuinely produces
"towers but no overlay", and it now has the same fix: guard the adds, re-arm
`renderRaster()` from the cached `lastRaw` on `map.once('load')`. Idempotent
(`getSource`/`getLayer` guards) so a half-applied attempt can't double-add.

## Legend

`index.html` cellular legend updated to the new bands (−85/−95/−105/−110).
The RF-coverage legend (`#thExcellent` etc.) already defaulted to −85 and is
untouched.
