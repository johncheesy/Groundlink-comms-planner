# M49 — Antenna model (gain, beamwidth, pointing, presets)

**Status:** built 22 Oct 2026 · review item "Antenna model" (P1)

## Problem

Coverage used a fixed 2.15 dBi transmit gain and 0 dBi receive gain. A Yagi
or sector antenna, the normal way to reach far in one direction, could not be
planned.

## What it does

- **Coverage panel:** *Tx antenna* preset and *Pointing* (compass bearing,
  enabled for directional antennas). Advanced mode adds gain (dBi),
  horizontal beamwidth, front-to-back ratio and *Rx antenna gain*. Editing a
  value switches the preset to *Custom*.
- **Presets** (typical catalogue values, `src/coverage/antenna.js`): dipole /
  whip 2.15 dBi omni (the previous default), collinear 6 dBi omni, Yagi
  3-element 7 dBi / 70° / 15 dB, Yagi 5-element 10 dBi / 50° / 20 dB,
  sector 90° 12 dBi / 25 dB, panel 60° 14 dBi / 25 dB.
- **Pattern:** 3GPP TR 36.814 parabolic horizontal pattern,
  `min(12·(φ/φ3dB)², FB)` dB below the peak; −3 dB at the beam edge, capped
  at the front-to-back ratio. EIRP carries the peak gain; the coverage worker
  subtracts the pattern loss towards each cell. Vertical pattern not modelled.
- **Where it applies:** coverage (both built-in engines), team coverage,
  calibration, path profile and mast wizard EIRP (peak gain: they assume the
  antenna points along the link), CloudRF (custom pattern `ant: 0` with
  `hbw`/`fbr`/`azi`, plus `rxg`). Site search plans with an omni dipole,
  because a mast that is not placed yet has no pointing.
- Saved in the mission file (`coverage.antenna`, `coverage.rxGainDbi`); older
  files load as dipole / 0 dBi. Shown in the result card's assumptions line.

## Open

- Per-site pointing (one antenna setting applies to every transmitter; the
  worker already accepts `txs[i].antenna`).
- Pattern file import (e.g. MSI/Planet), vertical pattern and tilt.
- A pointing arrow on the map.
