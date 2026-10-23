# GroundLink — Docs Index

Mapping of every milestone → spec file → dispatch → primary source files → build status.

**Important — M-number note:** The roadmap (`roadmap-2026H2.md`) originally defined M27–M50 as a future backlog. The repo then *built* M27 and M35–M47 with entirely different meanings (roadmap M36 = antenna-pattern import; built M36 = ops dashboard; etc.). The backlog has been renumbered to **M60+** to resolve the collision. See the reconciliation table at the bottom of this file.

---

## Built milestones (M1–M23, E1, E2, E3b, E4, M27, M35–M47)

| Milestone | Name | Spec | Dispatch | Key source files | Status |
|---|---|---|---|---|---|
| M1 | Map shell + AOI | — | — | `src/map/map.js`, `index.html` | ✅ built |
| M2 | Terrain + FSPL/Deygout coverage | `M2-propagation.md` | — | `src/coverage/`, `src/workers/dem.js` | ✅ built |
| M2.1 | Drone relay | `M2.1-drone-relay.md` | — | `src/coverage/`, `src/ui/` | ✅ built |
| M3 | Site recommendation | `M3-site-recommendation.md` | `dispatch-M3.md` | `src/recommend/` | ✅ built |
| M4 | Mission inputs | `M4-mission-inputs.md` | — | `src/mission/` | ✅ built |
| M5 | Radio import & mix | `M5-radio-import.md` | — | `src/radios/` | ✅ built |
| M6 | PACE + comms plan | `M6-pace-report.md` | — | `src/pace/` | ✅ built |
| M7 | Radio arsenal + node roles | `M7-node-roles.md` | — | `src/radios/roles.js` | ✅ built |
| M8 | Power & endurance (incl. ATAK powerbank) | `M8-power-endurance.md` | `dispatch-M8.md` | `src/power/` | ✅ built |
| M9 | Cellular connectivity layer | `M9-connectivity-layers.md` | `dispatch-M9-M10.md` | `src/connectivity/` | ✅ built |
| M10 | 3D fill-extrusion view | `M10-3d-view.md` | `dispatch-M9-M10.md` | `src/map/` | ✅ built |
| M11 | Waypoints | — | — | `src/mission/waypoints.js` | ✅ built (commit-only) |
| M12 | HF / ionosphere | — | — | `src/coverage/hf.js` | ✅ built (commit-only) |
| M13 | Teams + Erlang-B | — | — | `src/mission/erlang.js` | ✅ built (commit-only) |
| M14 | Path profile / Fresnel / link budget | — | — | `src/analysis/` | ✅ built (commit-only) |
| M15 | Digital modes (DMR/P25/dPMR) | — | — | `src/coverage/digital.js` | ✅ built (commit-only) |
| M16 | Data export (GeoTIFF/KMZ/GeoJSON/CivTAK) | — | — | `src/export/` | ✅ built (commit-only) |
| M17 | Offline PWA | — | — | `public/sw.js`, `public/manifest.webmanifest` | ✅ built (commit-only) |
| M18 | CloudRF ITM backend | — | — | `src/backends/cloudrf.js` | ✅ built (commit-only) |
| M19 | Workspace UX | `M19-workspace-ux.md` | `dispatch-M19.md` | `src/ui/`, `src/main.js` | ✅ built |
| M20 | UX refinement (⌘K, right rail, stale pill) | `M20-ux-refinement.md` | `dispatch-M20.md` | `src/ui/`, `src/main.js` | ✅ built |
| M21 | Mission file save/load + focus mode | `M21-mission-file-focus.md` | `dispatch-M21.md` | `src/io/`, `src/ui/focus.js` | ✅ built |
| M22 | Cellular tower race fix + best-network | `M22-cellular-bestnet.md` | — | `src/connectivity/cellular.js` | ✅ built |
| M23 | SW update flow + Photon typeahead | `M23-sw-update-flow.md`, `M23-fixes.md` | — | `public/sw.js`, `src/ui/search.js` | ✅ built |
| E1 | PMTiles/COG data layer + offline OPFS | `E1-pmtiles-cog-data.md` | `dispatch-E1.md` | `src/data/`, `src/map/pmtiles.js` | ✅ built |
| E2 | ITU-R P.1812 in-browser engine | `E2-p1812-engine.md` | `dispatch-E2.md` | `src/coverage/p1812.js` | ✅ built |
| E3b | Model accuracy badge | — | — | `src/ui/badges.js` | ✅ built |
| E4 | ITU-R P.618-14 rain-fade engine | `E4-rain-fade.md` | — | `src/analysis/rain-fade.js` | ✅ built |
| M48 | Live LEO/MEO pass window (SGP4 on CelesTrak) | `M48-leo-passes.md` | — | `src/connectivity/leo-pass.js`, `src/connectivity/leo-tle.js`, `src/ui/satcom-panel.js` | ✅ built |
| M49 | Antenna model: gain, beamwidth, pointing, per-site aiming, beam wedges | `M49-antenna-model.md` | — | `src/coverage/antenna.js`, `src/map/antenna-beams.js` | ✅ built |
| M50 | Feeder loss, per-site height and power, radio links | `M50-site-rf-links.md` | — | `src/mission/mission.js`, `src/map/radio-links.js` | ✅ built |
| M51 | 3D masts on the map (fill-extrusion prisms; glTF models as phase 2) | `M51-3d-masts.md` | — | `src/map/masts-3d.js` | ✅ phase 1 built |
| M52 | Ops workspace: tool strip + flyouts, status rail, data drawer, phone tab bar (default since 0.10.0-beta; `?ws=classic`) | `M52-ops-workspace.md` | — | `src/ui/ops-shell.js`, `src/ui/ops-rail.js`, `src/ui/ops-drawer.js` | ✅ built |
| M27 | Field calibration (RSSI CSV, bias offsets) | `M27-field-calibration.md` | — | `src/analysis/calibration.js` | ✅ built |
| M35 | Mast-height wizard | `M35-mast-height-wizard.md` | `dispatch-M35.md` | `src/analysis/mast-height.js`, `src/ui/mast-wizard.js` | ✅ built |
| M36 | Mission ops dashboard | `M36-ops-dashboard.md` | — | `src/ui/dash-ops.js` | ✅ built |
| M37 | Mission brief export | `M37-mission-brief-export.md` | — | `src/export/brief.js` | ✅ built |
| M38 | Satcom overview (GEO look-angle, LEO badges) | `M38-satcom-overview.md` | — | `src/connectivity/satcom.js`, `src/ui/satcom-panel.js` | ✅ built |
| M39 | Frequency deconfliction | `M39-freq-deconflict.md` | — | `src/analysis/freq-deconflict.js`, `src/ui/deconflict-panel.js` | ✅ built |
| M40 | Frequency plan export | `M40-freq-plan-export.md` | — | `src/export/freq-plan.js` | ✅ built |
| M41 | Network topology SVG | `M41-topology.md` | — | `src/ui/topology.js` | ✅ built |
| M42 | Drone altitude optimiser | `M42-drone-optimizer.md` | — | `src/analysis/drone-optimizer.js` | ✅ built |
| M43 | Coverage gap report | `M43-gap-report.md` | — | `src/export/gap-report.js` | ✅ built |
| M44 | Satcom rain-fade margin UI | `M44-satcom-fade.md` | — | `src/ui/satcom-panel.js` (updated) | ✅ built |
| M45 | Link-quality topology edges | `M45-link-quality-topology.md` | — | `src/ui/topology.js` (updated) | ✅ built |
| M46 | Smart radio-to-node suggestions | `M46-radio-suggest.md` | — | `src/analysis/radio-suggest.js`, `src/ui/radio-suggest-panel.js` | ✅ built |
| M47 | Mission readiness score | `M47-readiness.md` | — | `src/analysis/readiness.js`, `src/ui/dash-ops.js` (updated) | ✅ built |

---

## Backlog (M60+) — renumbered from old roadmap M27–M50

The roadmap-2026H2.md backlog has been renumbered to avoid collision with built milestones. Old numbers are shown for traceability.

| New # | Old # | Name | Spec | Notes |
|---|---|---|---|---|
| M60 | M39 (roadmap) | Flight track overlay (KML/GPX import, altitude profile, coverage at altitude) | `M60-flight-track-overlay.md` | Future |
| M61 | M40 (roadmap) | 4D mission planning (time dimension on waypoints, coverage animation) | — | Future |
| M62 | M41 (roadmap) | Live relay telemetry (MAVLink/ATAK stream, real-time relay coverage) | — | Future |
| — | M29 (roadmap) | Fresnel zones | ≈ built M14 | Satisfied |
| — | M30 (roadmap) | Coverage confidence overlay | ≈ built E3b | Satisfied |
| — | M35 (roadmap) | Mast-height wizard | = built M35 | Satisfied |

*The full roadmap is in `roadmap-2026H2.md`. Items not listed here remain as-is in the roadmap with their original numbers for reference.*

---

## Parked / superseded

| File | Reason |
|---|---|
| `parked/M46-pace-engine-superseded.md` | Original M46 spec (PACE engine) — superseded by built M46 (radio-suggest) |
| `parked/dispatch-M46-superseded.md` | Dispatch for superseded M46 PACE engine |
| `M24-best-server.md` | Backlog spec (best-server + interference views) — not yet built |
| `M26-auto-bom.md` | Backlog spec (auto-cost BOM) — not yet built |
