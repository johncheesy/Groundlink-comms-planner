# M27 — Field calibration (measured RSSI import)

> **Status: built — 13 Jun 2026.** Roadmap origin: "Propagation v2 …
> calibration: import field-measured RSSI points" (2026H2 roadmap). The
> calibration half ships here; ITM/WASM remains open.

Field measurements are the difference between "indicative" and "defensible".
M27 lets a user walk/drive the AOI with a radio, log received levels, and
feed them back: import a CSV, see where the model disagrees, fit one offset
per radio, and apply it to that radio's coverage computes.

## Format

CSV with a header row; columns (aliases in parentheses, any order):
`lat` (latitude), `lon` (lng/longitude), `dBm` (rssi/signal_dbm),
`radio_id` (radio — optional; rows without it fit under one unnamed bucket).
Quoted fields and CRLF are fine. Hard cap 2 000 rows (keeps the point-wise
prediction interactive); out-of-range rows (|lat|>90, |lon|>180, dBm outside
[−160, 0]) are skipped and counted.

## How it works

- **Predict** (`predictDbm`, `src/analysis/calibration.js`): the worker's
  FSPL + Deygout cell math, re-run point-wise on the main thread — same
  `model.js`/`profile.js` functions, DEM via the E1 sampler (local COG →
  offline package → Terrarium). Transmitters resolve like a coverage run:
  fixed sites, else the AOI centre. Per-point link params come from the
  coverage form, with freq/EIRP overridden from the arsenal radio whose
  id or label matches the row's `radio_id`.
- **Fit** (`fitCalibration`): per radio, `offset = mean(measured − predicted)`
  — a linear bias. The table shows n, offset, and RMSE before → after so a
  3-point "calibration" is visibly weak. Spread (sd) rides along in the export.
- **Dots**: each point paints on the map — teal within ±3 dB, azure where the
  model is conservative (measured stronger), rose where it is optimistic
  (measured weaker — the dangerous direction for planning). Layer adds use
  the guarded try/catch + `once('load')` retry pattern.
- **Apply**: offsets store per `radio_id` (`gl.calibration.v1`, localStorage
  with try/catch fallback) and shift `eirpDbm` at compute time:
  team coverage (M13) keys off each team's radio automatically; the main
  coverage form applies the offset of the radio chosen in the panel's
  "Main coverage uses" select. Applying arms the M20 stale-plan pill —
  nothing recomputes silently.
- **Export**: `groundlink-calibration.json` — format/version, engine,
  per-radio offset + n + RMSE before/after + sd. **No coordinates** leave the
  panel (OPSEC): measurement positions stay in-memory.

## Honesty & limits

- A constant offset corrects systematic error (antenna gain assumptions,
  cable loss, body loss, average clutter) — it cannot fix terrain geometry or
  direction-dependent effects. RMSE-after tells you how much residual scatter
  the offset cannot explain.
- v1 predicts with the FSPL+Deygout engine only; a P.1812 run calibrated with
  FSPL-fitted offsets mixes models — the panel's prediction and the offset
  apply to the same fallback engine the worker uses when P.1812 is off.
- Prediction needs the mission transmitter(s) to be where they really were
  when measuring; importing with a different tx layout fits garbage.

## UI

Coverage section → ADV mode → "Field calibration (RSSI)" disclosure:
Import CSV → readout (points, skipped, terrain-aware or flat, agreement
count) + per-radio fit table (reuses the compact `.teams-table` styles) →
Apply offsets / Export calibration (JSON) / Clear. Status line + stale pill
reflect application. Dev/test handle: `__gl.calibration.importText(csv)`.

## Tests

`src/analysis/calibration.test.js` (13): CSV parsing (aliases, quoting,
range validation, cap), free-space prediction anchor against `fsplDb`,
strongest-of-N txs, knife-edge loss appears with a synthetic ridge DEM,
per-radio fit means + RMSE before/after, bucket thresholds, export contains
no coordinates. Synthetic 0–1° coordinates only.

## Size note

Pure logic is a lazy chunk (`calibration-*.js`, ~3 kB); the panel wiring adds
~6 kB to the main bundle (299.8 → 306.3 kB after the perf split — recorded
here so the perf doc's number stays auditable).
