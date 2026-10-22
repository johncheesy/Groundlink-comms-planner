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

## Interference view (C/I) — added 22 Oct 2026

Review item "Best-server and interference rasters": the overlap band only
compared the top two sites. The third view, **Interference**, shows the
carrier-to-interference ratio with every site on one channel (simulcast or
single-frequency reuse — the worst case):

- **Worker:** with `collectServer`, sums the linear power of every site above
  the floor per cell; `ciQ` = best ÷ (sum − best) in dB, quarter-dB offset by
  10 dB (`quantizeCiDb`), 255 = no other site above the floor. One more byte
  per cell, transferred with the rest.
- **Raster** (`buildInterferenceImage`): only usable cells (class ≤ 2), five
  bands ≥20 / 12–20 / 6–12 / 0–6 / <0 dB in the coverage spectrum tokens
  `--s1…--s5` (teal clean → rose, the interferer wins). Summary: share of the
  covered area below 12 dB C/I, where most FM and digital voice breaks up.
- **UI:** Quality / Best server / Interference switch; the overlap margin is
  now editable (1–20 dB, was fixed at 6) and only shown on the zone map;
  ⌘K commands "Best-server zones" and "Interference map (C/I)".
- Exports pick up whichever view is on screen (they read the painted canvas).

Not an SINR: thermal noise, capture effect and per-site channels are not
modelled. Different channels per site are the next step (needs a channel
field per site).

## Honesty

Same engine, same planning-grade caveats. "Best server" is the strongest
*modelled* signal — sectorisation, downtilt and load balancing are not
modelled; the contested band is a margin statement, not an SINR computation.

## Non-goals (this slice)

- A/B plan comparison (the other half of roadmap M24) — needs a second plan
  snapshot to diff; pairs naturally with the mission-file work, later.
- True SINR with noise and per-site channel assignments (C/I with one shared
  channel is built, see above).
- Cellular layers (each network type is its own single-tint compute; the
  M22 best-network heuristic already covers the operator question there).

## Tests

`src/coverage/bestserver.test.js` — image building per winner, transparency,
contested-band thresholds (quarter-dB edges), the reserved single-source
margin, palette cycling, legend ordering/naming; margin quantization
round-trip. Worker contract exercised live in the browser (multi-site run →
toggle → zones + contested band; single-site run → control hidden).
