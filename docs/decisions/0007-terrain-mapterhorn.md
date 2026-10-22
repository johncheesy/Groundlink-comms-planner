# 0007 — Terrain from Mapterhorn (Copernicus GLO-30), capped at zoom 12

**Date:** 22 Oct 2026 · **Status:** accepted (zoom 13+ unlocked for small P.1812 runs by ADR 0008) · **Context:** product review P1 "credibility" items; height-data research (no CORS on Copernicus DEM in AWS, Mapterhorn keyless with CORS)

## Problem

Coverage, path profiles, the drone envelope and offline packages used AWS Terrarium tiles, an SRTM-based mix about 20 years old with known biases (checked: Matterhorn 4274 m vs 4478 m true, Dead Sea −412 m vs about −430 m, Amsterdam +6.8 m vs about 0 m). Copernicus GLO-30 is better, but its AWS bucket has no CORS, so a browser cannot read it directly.

## Decision

- Use **Mapterhorn** (`tiles.mapterhorn.com`, keyless, CORS, Terrarium encoding, lossless WebP, 512 px) as the terrain source, **up to zoom 12 only**. Up to zoom 12 it is Copernicus GLO-30 everywhere: a 30 m surface model. Checked with the same three places: 4441 m, −432 m, +1.5 m.
- **Do not use zoom 13+.** There Mapterhorn serves LiDAR in about 35 countries, but almost all of it is bare-earth (DTM). GroundLink has no global clutter layer yet, so removing trees and buildings from the ground would make coverage optimistic. This follows ADR 0005 (one representation of clutter per engine, never double, never missing silently).
- **Per-tile fallback to AWS Terrarium**, because Mapterhorn is volunteer-run with no published SLA or usage policy.
- **Decode each tile on its own.** Mapterhorn tiles are 512 px and a fallback tile is 256 px; Terrarium RGB must never be scaled as an image (interpolated colour channels give nonsense heights). `createMosaicSampler` reads each tile at its own resolution and crosses tile edges correctly (tested across a 512/256 seam).
- The path profile now uses the same sampler and zoom 12 for short paths (was zoom 10 on its own copy of the tile maths).
- The 3D map terrain stays on AWS for now: it is a visual, and MapLibre's `raster-dem` source has no per-tile fallback.

## Consequences

- Better heights wherever GLO-30 beats SRTM (mountains, below-sea-level areas, flat deltas). Coverage, profiles, drone envelope and offline packages all see the same ground.
- The result card and help text name the terrain source ("Copernicus GLO-30 via Mapterhorn", or the fallback when used).
- Dependency on a volunteer service. Mitigation: fallback today; later, self-host a regional PMTiles extract or mirror.
- Next step that unlocks zoom 13+: a global clutter layer (WorldCover) and canopy height (Meta CHMv2), then LiDAR DTM + clutter can replace the surface model where both exist.

## Attribution

Copernicus DEM: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved". Mapterhorn: see https://mapterhorn.com/attribution.
