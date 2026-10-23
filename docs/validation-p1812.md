# P.1812 validation against the ITU-R reference set

**Status:** first run 22 Oct 2026 · published page: `public/validation/index.html`
(served at `/validation/`), data `public/validation/p1812.json`.

## What is compared

The ITU-R Working Party 3M validation set for Recommendation P.1812: 19 terrain
profiles, 63 test cases (1–235 km, land / sea / mixed, 30 MHz–6 GHz, 1–50 %
time, H and V polarisation, with and without clutter). The reference
implementation logs every intermediate result, so each stage is compared:
Lbfs, Lb0p, Ld50, Ldp, Lbs and the final Lb.

`scripts/validate-p1812.mjs` feeds each case's own inputs (from the reference
log: f, p, htg, hrg, pol, ΔN, N0, path-centre latitude, ω, dtm, dlm; profile
heights and clutter heights from the profile file; pL = 50, σL = 0) into
`src/coverage/p1812.js` — the engine the coverage worker runs.

## Data handling

The validation files are **not** in this repository (user's decision, 22 Oct
2026). They come with the reference implementation
(github.com/eeveetza/Py1812 → `tests/`). Download them outside the repo and run:

    node scripts/validate-p1812.mjs /path/to/Py1812/tests

Only deviations and non-identifying case descriptors (distance, frequency,
time %, polarisation, sea fraction, clutter yes/no) are written to the JSON.
No coordinates, terrain heights or profile points.

## Results (22 Oct 2026)

| Stage | Max \|Δ\| | Within 0.1 dB |
| --- | --- | --- |
| Lbfs, Lb0p, Ld50, Ldp, Lbs | < 0.001 dB | 63/63 each |
| Lb (final) | 14.38 dB | 61/63 |

The two final-loss deviations are GroundLink predicting **more** loss:
**no ducting** (1 GHz at 1 % time; §4.4 is omitted, E2 decision).

Until 22 Oct 2026 (later the same day) the engine also kept the P.1812-6
§4.7 terminal clutter loss, which gave 14 more deviations of up to +57 dB.
It now follows -8, with a dense near-terminal profile in the coverage worker
(ADR 0010).

## What changed because of this run

The first run showed diffraction on cluttered paths off by up to 8 dB,
troposcatter by up to 111 dB and Ldp on the sea path by 1.1 dB. Causes, all
fixed in `p1812.js` to follow P.1812-8:

- horizon angles θt/θr and the angular distance θ used terrain + clutter;
  -8 uses bare terrain (eqs. 76–84);
- the smooth-earth obstruction correction used terrain + clutter; -8 uses
  bare terrain (eq. 89d);
- on LoS paths dlt/dlr were taken at mid-path; -8 uses the largest-ν point;
- β0 used (1 − ω)·d for both land stretches; it now accepts dtm/dlm.

## Not covered

This proves the implementation, not the model's accuracy in the field. A
comparison with field RSSI (M27 calibration files) and CloudRF is the next
step for the page.
