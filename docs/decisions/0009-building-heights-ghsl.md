# 0009 — Building heights in clutter from GHSL, not per-building footprints

**Date:** 22 Oct 2026 · **Status:** accepted · **Context:** user asked for "individual buildings (Overture heights) in the coverage calculation"; follows ADR 0008 (canopy)

## Problem

Built-up land had one clutter height everywhere: 8 m and 10 dB from the
WorldCover class table, whether a village of bungalows or a city centre.

## What we checked

- **Overture buildings PMTiles** (the archive the 3D view uses, source.coop):
  footprints yes, heights almost never — Amsterdam 89 of 8,027 buildings,
  Nairobi 10 of 7,493, rural NL 0. Tiles are 0.3–1 MB at zoom 13–14, so a
  40 km area would download tens of MB of mostly height-less polygons.
- **Current Overture releases:** the public tile bucket answers 403; no
  buildings-only PMTiles with CORS found.
- **GHSL GHS-BUILT-H R2023A** (European Commission JRC, CC BY 4.0): global
  average building height per 3 arc-second (~90 m) cell, epoch 2018, one
  COG on the AWS Open Data bucket `jrc-ghsl` with CORS `*` and overviews.
  Spot values: Amsterdam centre 13–17 m, Nairobi CBD 20–40 m, Manhattan
  15–36 m, rural NL 0–2.5 m. A read takes 0.4–1 s.

The coverage grid has 100–300 m cells and P.1812 profiles are sampled about
1 km apart, so single buildings cannot be resolved anyway. P.1812 asks for a
*representative* clutter height per location; a block average is that.

## Decision

- Use **GHSL ANBH** (average *net* building height: built volume ÷ built
  surface, i.e. how tall the buildings in the block are) as building clutter
  height (`src/data/buildings.js`), capped at 60 m.
- WorldCover **built-up** pixels take the GHSL height; without GHSL data they
  keep the 8 m table value. Vegetation and open classes keep the canopy rules
  of ADR 0008. Without land cover, the taller of buildings and canopy wins.
- Loss for the fallback engine follows the height (`clutterDbForHeight`).
- The Overture footprints stay a 3D-view layer only.

## Consequences

- Built-up clutter now varies with the place: built cells in Amsterdam
  6–17 m (median 10.5), Nairobi 7–14 m, Veluwe villages 3–12 m (median 7.5),
  instead of 8 m everywhere. A P.1812 run in Amsterdam (450 MHz, 8 W, 20 m
  mast) covers 64% with clutter vs 100% without.
- Epoch 2018: newer districts may still show the table value or low heights.
- GHSL is known to overestimate heights in dense informal settlements
  (Kibera: 13 m for mostly one-storey housing); treat those areas as
  pessimistic.
- With the GLO-30 surface model, part of each building is already in the
  terrain, so cities can be counted partly twice (as with the old 8 m value,
  now with taller numbers). The LiDAR path of ADR 0008 removes this where
  LiDAR exists.
- Offline packages do not include building heights yet (offline is the next
  phase).

## Attribution

Pesaresi, M., Politis, P. (2023): GHS-BUILT-H R2023A — GHS building height,
derived from AW3D30, SRTM30, and Sentinel-2 composite (2018). European
Commission, Joint Research Centre. CC BY 4.0.
