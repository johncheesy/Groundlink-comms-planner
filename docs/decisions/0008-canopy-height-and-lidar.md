# 0008 — Meta canopy height in clutter, bare-earth LiDAR for small P.1812 runs

**Date:** 22 Oct 2026 · **Status:** accepted · **Context:** product review P1 (clutter, F10); follow-up named in ADR 0007

## Problem

Clutter heights came from a fixed table per ESA WorldCover class: every
"tree cover" pixel was 20 m, every shrubland pixel 4 m. A young plantation,
open bush and a tall rain forest all looked the same to the model. ADR 0007
also kept Mapterhorn's sharper LiDAR terrain (zoom 13+) switched off until
real clutter heights existed, because LiDAR there is bare earth.

## Decision

- **Canopy source:** Meta/WRI Canopy Height Map v2 (~1.2 m, CC-BY-4.0) from
  the Taylor Geospatial CORS mirror on source.coop
  (`data.source.coop/tge-labs/meta-chm-v2/chm/{quadkey}.tif`, one COG per
  zoom-10 Web-Mercator tile). Meta's own bucket has no CORS. No key.
- **Resolution:** read the overview that matches the run (1024 px across the
  area), never finer than the 1024 px level (~38 m Mercator, ~23 m on the
  ground at 52°). P.1812 wants a representative clutter height, and each
  uncached range read on the mirror costs 1–4 s.
- **Large areas:** more than 48 tiles (about 150 km wide at 52°) gets no
  canopy layer and keeps the class table. The mirror's global overview
  (~611 m) averages forest down to ~6 m, which would *lower* clutter.
- **Blend with WorldCover** (`blendClutter` in `src/data/sources.js`):
  forest and mangrove take the measured height; other vegetation (shrub,
  grass, crop, wetland, moss) takes the taller of table and canopy, so tree
  lines in farmland count; built-up, bare, snow and water keep the table
  (canopy maps miss buildings). No canopy data → the table, as before. Loss
  in dB for the fallback engine follows the height (`clutterDbForHeight`).
- **LiDAR terrain:** for small areas (zoom 13–14) the coverage worker swaps
  the GLO-30 surface model for Mapterhorn's bare-earth LiDAR, only when all
  of these hold: engine is P.1812, clutter is on and loaded, every tile of
  the area has LiDAR (all or nothing), and no local elevation COG or offline
  package is in use. The FSPL+Deygout engine keeps GLO-30: it only applies
  clutter at the receiver, so bare earth would drop trees between the
  stations.

## Consequences

- Forest clutter now varies with the real stand: Veluwe tree-cover median
  11–12 m, Amazon 20 m, Nairobi tree cover 3 m (previously 20 m everywhere).
- With GLO-30 (a surface model) some canopy is already in the terrain, so
  adding measured heights can count part of it twice. This was already true
  for the 20 m table, which is higher than most measured stands; the LiDAR
  path removes it where LiDAR exists.
- Cold runs wait on the mirror: about 5 s for a 40 km area, under 1 s once
  cached. The read runs in parallel with terrain and land cover.
- Mast wizard, path profile and site search keep GLO-30 terrain for now.

## Attribution

Tolan et al. (2024) and Brandt et al. (2026), Meta / World Resources
Institute, CC-BY-4.0; cloud-native repackaging by Taylor Geospatial Engine
Labs (source.coop).
