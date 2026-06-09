# M9 — Cellular connectivity layer (LTE / 3G / 4G / 5G) (authoritative spec)

Add **cellular coverage** alongside the radio coverage, **modelled from cell-tower
locations through the existing terrain engine** — not a third-party coverage
overlay. Free and **no runtime key**: ship a regional tower snapshot. Read
alongside `CLAUDE.md`, `docs/M2-propagation.md`, `../roadmap-next.md` (§4).

## Decision recap (from roadmap-next.md)

Free / no-key only. Model from **OpenCelliD** towers (CC BY-SA 4.0, the open
successor to Mozilla Location Service) reusing the M2 FSPL+Deygout engine. A
shipped, filtered snapshot avoids any runtime key. Honest, planning-grade.

## 1. Data — OpenCelliD snapshot (build-time, no runtime key)

- OpenCelliD bulk export is gated behind a **free** API key. Use it **at data-prep
  time only** — never embed a key in the app.
- `scripts/fetch-opencellid.mjs` (Node, run manually / in a data step): reads
  `OPENCELLID_KEY` from the environment (local, **never committed**), downloads
  the cells for a bounding box / MCC, filters to the fields we need, and writes a
  compact `public/cells/<region>.json`:

  ```
  { region, generated, attribution,
    cells: [{ lat, lon, radio, mcc, net, range, samples }] }   // radio: GSM|UMTS|LTE|NR
  ```

- Ship one small default snapshot (e.g. **NL**, the likely AO). Document how to
  regenerate / add a region in the script header. The snapshot is public data —
  committing it is OPSEC-fine; **attribute OpenCelliD (CC BY-SA)** in the UI.
- OpenCelliD CSV columns for reference: `radio,mcc,net,area,cell,unit,lon,lat,
  range,samples,changeable,created,updated,averageSignal`.

## 2. Model — towers → coverage raster (`src/connectivity/cellular.js`)

Treat each tower as an omni transmitter and reuse the coverage worker:

- **Band → frequency presets** (user-selectable, editable):
  | Preset | MHz | Note |
  |--------|-----|------|
  | 5G low (n28) | 700 | wide rural reach |
  | LTE B20 | 800 | rural/in-building |
  | 900 (GSM/B8) | 900 | legacy 2G/3G |
  | 1800 (B3) | 1800 | capacity |
  | 2100 (B1) | 2100 | 3G/4G urban |
  | 2600 (B7) | 2600 | urban capacity |
  | 5G mid (n78) | 3500 | dense urban, short |
- **Defaults (editable):** macro EIRP ≈ **+58 dBm** (≈ a few hundred W ERP per
  sector, omni approximation), tower height **30 m**, device RX **1.5 m**, RX
  sensitivity **−100 dBm** (LTE). Downlink-style — the binding link is tower→device.
- Filter the snapshot by **radio type** (GSM/UMTS/LTE/NR) and the map viewport;
  pass the towers as `txs[]` to the existing multi-tx coverage worker (M3 added
  `txs[]`), one run per selected band, painting the same signal palette.
- Cap the tower count fed to a single run (e.g. nearest N within the viewport +
  range) to stay responsive; reuse the chunked-progress pattern.

## 3. UI — "Cellular" layer

- A new layer toggle (Legend/Layers area): **Cellular coverage** on/off.
- Controls: **radio type** (2G/3G/4G/5G) + **band preset** + editable EIRP/height;
  an operator filter (`mcc`/`net`) is optional (label by MNC where known).
- Render the modelled raster with the existing signal scale; show a tower-count +
  "modelled from N OpenCelliD towers" readout and the **CC BY-SA attribution**.
- It is a **layer**, independent of the mission radio coverage — both can be on;
  keep z-order sane (cellular under mission coverage, or switchable).

## 4. Caveats (surface in-app — honesty matters)

- OpenCelliD is **crowdsourced**: tower presence, position and `range` vary; 5G/NR
  is partial; absence ≠ no coverage.
- Real cells are **sectorised + downtilted**; the omni FSPL model over-/under-
  states per direction. **Planning-grade approximation, not an operator map.**

## Acceptance

1. With the shipped NL snapshot, toggling **Cellular · LTE 800** paints a
   terrain-aware raster from the towers in view; the tower count + OpenCelliD
   attribution show.
2. Switching band (e.g. n78 3500) visibly shortens reach; editing EIRP recomputes.
3. No network key anywhere in the app bundle; the snapshot loads client-side.
4. Mission radio coverage and cellular coverage can be shown independently.
5. `cellular.js` band/preset mapping is pure + unit-tested; the data-prep script
   documents regeneration and never commits a key.
