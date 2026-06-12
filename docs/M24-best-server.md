# M24 — Best-server + interference view

> **Status: built — 12 Jun 2026** (roadmap `../../roadmap-2026H2.md` → M24;
> the A/B plan-comparison half of that entry is deferred, see Non-goals).

For multi-site networks, the two views that make planning legible (the
pro-suite lesson from the competitive research):

- **Best server** — every covered cell colours by the site whose signal wins
  there, the operator-style zone map. Answers "who serves this valley?"
- **Interference / overlap** — cells where the top two sites land within a
  margin (default 6 dB) paint as a contested band: co-channel interference
  risk and handover-zone candidates at the same time.

## How it works

- **Worker** (`coverage.worker.js`): the per-cell transmitter loop already
  evaluates every site to take the max; with `params.collectServer` (set
  automatically by the controller whenever ≥ 2 txs are passed) it also records
  the winning site index (`servers`, 255 = below floor) and the best-vs-second
  margin in quarter-dB (`marginQ`, 255 = only one site reaches the cell;
  a second site below the floor counts as absent). Two extra bytes per cell,
  both engines (P.1812 and FSPL+Deygout), transferred with the classes.
- **Pure raster building** (`src/coverage/bestserver.js`, TDD):
  `buildServerImage(servers, marginQ, {palette, interference, thresholdDb})`
  → RGBA + per-site counts + contested count. Contested cells keep counting
  for their winner so zone shares stay meaningful.
- **Controller** (`coverage.js`): caches the raw worker arrays, so the
  Quality ↔ Best-server toggle **re-renders without a recompute**; stats,
  export canvas and the M16 exporters all keep working (they read whatever
  raster is on screen; classes-based stats are view-independent).
  `setView / setInterference / getServerInfo / hasServerData`.
- **UI**: a segmented Quality / Best server control + "Overlap < 6 dB"
  checkbox appears under the opacity row after any multi-site run (fixed
  sites, teams, or the M3 recommended-mast raster — the recommender passes
  numbered mast names for the legend). A chip legend lists zones by share;
  the M15 digital-cliff band hides in server view (it describes quality
  classes).
- **Colours**: new categorical tokens `--srv-1…8` + `--srv-contest`
  (`styles/tokens.css`) — distinct hues on the dark canvas, no purple/indigo
  per the design rules, cycling past 8 sites.

## Honesty

Same engine, same planning-grade caveats. "Best server" is the strongest
*modelled* signal — sectorisation, downtilt and load balancing are not
modelled; the contested band is a margin statement, not an SINR computation.

## Non-goals (this slice)

- A/B plan comparison (the other half of roadmap M24) — needs a second plan
  snapshot to diff; pairs naturally with the mission-file work, later.
- True SINR / C/I maps (needs per-site channel assignments).
- Cellular layers (each network type is its own single-tint compute; the
  M22 best-network heuristic already covers the operator question there).

## Tests

`src/coverage/bestserver.test.js` — image building per winner, transparency,
contested-band thresholds (quarter-dB edges), the reserved single-source
margin, palette cycling, legend ordering/naming; margin quantization
round-trip. Worker contract exercised live in the browser (multi-site run →
toggle → zones + contested band; single-site run → control hidden).
