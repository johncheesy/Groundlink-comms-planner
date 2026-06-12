# 0005 — P.1812 profile convention: bare-earth + explicit clutter, DSM runs terrain-only

**Date:** 12 Jun 2026 · **Status:** accepted · **Context:** E2 (`docs/E2-p1812-engine.md` §"Decisions to lock", item 2)

## Problem

ITU-R P.1812 wants two separate inputs per profile point: the **bare-earth
terrain height** and a **representative clutter height above ground**. Our
elevation source (AWS Terrarium tiles) is a DSM-ish blend — in built-up and
forested areas the "terrain" height already contains some of the canopy and
buildings. Feeding that profile *and* adding clutter heights on top would
count the clutter twice (the ⚠ in `docs/M2-propagation.md`).

## Decision

- `p1812Loss()` takes the profile as `{ distM, terrainM, clutterM }` —
  **terrainM is treated as bare earth, clutterM as the explicit representative
  clutter height** (the recommendation's native contract).
- The worker (`buildProfileP1812`) samples clutterM from the ESA WorldCover
  class → height table (`CLUTTER[cls].h` in `src/workers/worldcover.js`) only
  when the clutter toggle is on **and** the land-cover sampler loaded.
- **Where only the DSM is available (clutter off, or outside WorldCover's
  Africa footprint), P.1812 runs in terrain-only mode: clutterM = 0
  everywhere.** Whatever canopy/building height the DSM blend already carries
  then enters once, through the terrain profile, and nothing is double-counted.
- When the WorldCover clutter heights ARE used, the per-class **dB** clutter
  term of the fallback engine (`clutterDbForClass`) is NOT applied to P.1812
  cells — clutter affects P.1812 only via profile heights and the §4.7
  terminal correction. One representation per engine, never both.

## Consequences

- In DSM-heavy areas terrain-only P.1812 is mildly conservative-to-neutral
  (some clutter is "in the ground"), never doubled.
- E1/M31 bare-earth + canopy/building layers can later replace the WorldCover
  table without touching the engine — the profile contract already separates
  the two.
- Unit tests assert the no-double-count property directly: a profile with
  `clutterM: 0` everywhere produces bit-identical loss to one with no clutter
  field at all (`src/coverage/p1812.test.js`).
