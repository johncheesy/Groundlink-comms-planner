# M3 — Site recommendation (authoritative spec v2)

*Aligned with the M2 codebase as of the MODIS basemap commit. Read alongside `CLAUDE.md`, `docs/M2-propagation.md`, and `docs/design-tokens.md`.*

## Goal

User draws an AOI, sets radio params, clicks **Recommend sites** → the app proposes N numbered mast positions that together cover the AOI, shows the combined coverage raster, and lets the user drag any site to refine — with live recompute. All client-side, no coordinates leave the browser (OPSEC).

---

## Prerequisite: extract `buildProfile` to a shared module

`buildProfile` currently lives inside `src/workers/coverage.worker.js` as a local function. Both the recommend worker and the coverage worker need it. Before writing M3:

**Create `src/workers/profile.js`:**

```js
import { earthBulgeM } from '../coverage/model.js';

/**
 * Elevation profile between tx and rx, sampled at ~2 km spacing (8–40 points),
 * with the k = 4/3 earth bulge folded into each terrain height.
 *
 * @param tx   { lng, lat }
 * @param rx   { lng, lat }
 * @param totalDist  haversine distance in metres (pre-computed)
 * @param dem  DEM sampler from buildDem(), or null for flat-earth fallback
 * @returns    Array of { d, h } or empty array if dem is null
 */
export function buildProfile(tx, rx, totalDist, dem) {
  if (!dem) return [];
  const n = Math.max(8, Math.min(40, Math.round(totalDist / 2000)));
  const profile = [];
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const lng = tx.lng + (rx.lng - tx.lng) * f;
    const lat = tx.lat + (rx.lat - tx.lat) * f;
    const d1 = f * totalDist;
    const h = dem.sample(lng, lat) + earthBulgeM(d1, totalDist - d1);
    profile.push({ d: d1, h });
  }
  return profile;
}
```

Then remove the local `buildProfile` from `coverage.worker.js` and import from `./profile.js` instead. This is a refactor — no behavior change, verify the existing coverage test still passes.

---

## Pipeline — `src/workers/recommend.worker.js`

All heavy computation runs off the main thread. Message protocol:

### Message in

```
{
  type: 'recommend',
  id: <number>,
  bounds: { west, south, east, north },   // AOI bbox (padded ~10% for DEM)
  aoi: {
    type: 'radius' | 'polygon',
    center: { lat, lng },                 // circle centre or bbox centre
    radiusM: <number> | null,             // radius AOI only
    ring: [[lng, lat], ...]               // 72-point ring (radius) or polygon ring
  },
  params: {
    eirpDbm, freqMHz, rxGainDbi,
    txHeightM, rxHeightM,
    clutterDb, useTerrain, useClutter,
    thresholds: { excellent, good, marginal, none },
    floorDbm,
    maxSites: <1–6, default 3>,
    targetFrac: <0–1, default 0.95>
  }
}
```

### Messages out

```
{ type: 'progress', id, done, total, phase: 'data'|'score'|'cover' }
{ type: 'done', id,
    sites: [{ lat, lng, elevM, newlyCovered, cumulativeFrac }],   // pick order
    terrain: boolean,
    clutter: boolean
}
{ type: 'error', id, message: string }
```

---

## Step 1 — Demand grid (AOI-masked)

Build a grid of `rxHeightM`-height handheld positions inside the AOI. Target ≈ 500–700 in-shape points.

```js
// Scale cols/rows from AOI bbox aspect ratio, max dim ~28
// (same pattern as gridDims() in coverage.js but smaller)
function demandGrid(bounds, aoi, maxDim = 28) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const w = Math.abs(east - west) * Math.cos((midLat * Math.PI) / 180);
  const h = Math.abs(north - south);
  let cols, rows;
  if (w >= h) { cols = maxDim; rows = Math.max(4, Math.round((maxDim * h) / w)); }
  else { rows = maxDim; cols = Math.max(4, Math.round((maxDim * w) / h)); }

  const points = [];
  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * (north - south);
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * (east - west);
      if (inAoi(aoi, lng, lat)) points.push({ lng, lat });
    }
  }
  return points;  // typically 400–700 points
}
```

**`inAoi(aoi, lng, lat)` — AOI mask:**

```js
function inAoi(aoi, lng, lat) {
  if (aoi.type === 'radius') {
    return haversineM(aoi.center.lat, aoi.center.lng, lat, lng) <= aoi.radiusM;
  }
  // Polygon: ray-cast PIP against aoi.ring
  return pointInRing(aoi.ring, lng, lat);
}

function pointInRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
```

---

## Step 2 — Candidate generation (DEM local maxima)

```js
// Pad AOI bbox by ~10% so masts just outside the AOI are considered
const padded = padBounds(bounds, 0.10);

// Fetch DEM once — shared with scoring step
const dem = await buildDem(padded).catch(() => null);
const terrain = !!dem;

// Sample elevation on a ~64×64 grid over the padded bbox
const CAND_DIM = 64;
// ... fill elevGrid[r][c] = dem.sample(lng, lat) or 0

// Local maxima: cell higher than all 8 neighbours
const candidates = [];
for (let r = 1; r < CAND_DIM - 1; r++) {
  for (let c = 1; c < CAND_DIM - 1; c++) {
    const h = elevGrid[r][c];
    if (neighbours8(r, c).every(([nr, nc]) => elevGrid[nr][nc] <= h)) {
      candidates.push({ lng, lat, elevM: h });
    }
  }
}

// Enforce minimum separation: ~1/12 of bbox diagonal
// Keep the highest-elevation candidate within each cluster
const minSepM = diagonalM(padded) / 12;
const filtered = clusterFilter(candidates, minSepM); // keep strongest per cluster

// Top 30 by elevation + always include the AOI centroid
const top = filtered.sort((a, b) => b.elevM - a.elevM).slice(0, 30);
top.push({ lng: aoi.center.lng, lat: aoi.center.lat, elevM: dem?.sample(aoi.center.lng, aoi.center.lat) ?? 0 });
```

**DEM unavailable fallback:** 5×5 grid of candidates over the padded bbox + centroid. Set `terrain = false`; diffraction = 0 in all subsequent scoring. Report this in the `done` message.

---

## Step 3 — Point-to-point scoring

For each candidate × each demand point, compute received dBm using the exact same physics as M2.

Import from the shared modules:

```js
import { receivedDbm, classifyDbm, haversineM, deygoutLossDb } from '../coverage/model.js';
import { buildProfile } from './profile.js';   // extracted in prerequisite step
import { buildDem } from './dem.js';
import { buildLandcover, clutterDbForClass } from './worldcover.js';
```

Core scoring loop (after DEM and landcover are fetched):

```js
// coverageMatrix[candIdx][demandIdx] = boolean (covered = class <= 2 = marginal threshold)
const coverageMatrix = candidates.map(() => new Uint8Array(demand.length));

for (let ci = 0; ci < candidates.length; ci++) {
  const cand = candidates[ci];
  const txGround = dem ? dem.sample(cand.lng, cand.lat) : 0;
  const txElev = txGround + params.txHeightM;

  for (let di = 0; di < demand.length; di++) {
    const pt = demand[di];
    const dist = haversineM(cand.lat, cand.lng, pt.lat, pt.lng);
    let diffraction = 0;
    if (dem && dist > 50) {
      const rxGround = dem.sample(pt.lng, pt.lat);
      const rxElev = rxGround + params.rxHeightM;
      const profile = buildProfile(cand, pt, dist, dem);
      diffraction = deygoutLossDb(profile, txElev, rxElev, params.freqMHz, dist);
    }
    const clutterDb = landcover
      ? clutterDbForClass(landcover.sample(pt.lng, pt.lat))
      : (params.clutterDb ?? 0);
    const dbm = receivedDbm(params, dist, diffraction, clutterDb);
    const cls = classifyDbm(dbm, params.thresholds, params.floorDbm);
    coverageMatrix[ci][di] = cls <= 2 ? 1 : 0;  // marginal or better = covered
  }

  // Report per-candidate progress
  self.postMessage({ type: 'progress', id, done: ci + 1, total: candidates.length, phase: 'score' });
}
```

~30 candidates × ~600 demand points ≈ 18k path calculations — runs in < 2 s in a worker even with terrain.

---

## Step 4 — Greedy set-cover

```js
const chosen = [];       // { lat, lng, elevM, newlyCovered, cumulativeFrac }
const covered = new Uint8Array(demand.length);  // 0 = uncovered
let totalCovered = 0;

self.postMessage({ type: 'progress', id, done: 0, total: params.maxSites, phase: 'cover' });

for (let pick = 0; pick < params.maxSites; pick++) {
  // Find candidate covering the most currently-uncovered demand points
  let bestIdx = -1, bestNew = 0;
  for (let ci = 0; ci < candidates.length; ci++) {
    let newCount = 0;
    for (let di = 0; di < demand.length; di++) {
      if (!covered[di] && coverageMatrix[ci][di]) newCount++;
    }
    if (newCount > bestNew) { bestNew = newCount; bestIdx = ci; }
  }

  // Stop if best remaining candidate adds < 2% of demand points
  if (bestIdx === -1 || bestNew < demand.length * 0.02) break;

  // Accept this candidate
  for (let di = 0; di < demand.length; di++) {
    if (!covered[di] && coverageMatrix[bestIdx][di]) { covered[di] = 1; totalCovered++; }
  }
  candidates[bestIdx]._picked = true;  // prevent re-pick

  const cumulativeFrac = totalCovered / demand.length;
  chosen.push({ ...candidates[bestIdx], newlyCovered: bestNew, cumulativeFrac });

  self.postMessage({ type: 'progress', id, done: pick + 1, total: params.maxSites, phase: 'cover' });

  // Stop if target coverage reached
  if (cumulativeFrac >= params.targetFrac) break;
}

self.postMessage({ type: 'done', id, sites: chosen, terrain, clutter: !!landcover });
```

---

## Step 5 — Combined raster (multi-tx extension to existing worker)

Extend `src/workers/coverage.worker.js` to accept an optional `txs` array. Keep the single-`tx` message shape fully working (backward compat).

**Updated message-in shape:**

```
{
  type: 'compute', id, bounds, cols, rows,
  tx: { lat, lng },        // single tx (always present for compat)
  txs: [                   // optional; if present, overrides tx for multi-site
    { lat, lng, txHeightM },
    ...
  ],
  params: { ... }
}
```

**Updated inner loop — take max dBm across all transmitters:**

```js
// Resolve transmitter list
const txList = msg.txs?.length
  ? msg.txs
  : [{ lat: tx.lat, lng: tx.lng, txHeightM: params.txHeightM ?? 10 }];

// Pre-compute per-tx ground elevations
const txElevs = txList.map((t) => {
  const txGround = dem ? dem.sample(t.lng, t.lat) : 0;
  return txGround + (t.txHeightM ?? 10);
});

// Inner pixel loop:
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    // ... lng, lat, dist computed per-tx below ...
    let maxDbm = -Infinity;
    for (let ti = 0; ti < txList.length; ti++) {
      const t = txList[ti];
      const dist = haversineM(t.lat, t.lng, lat, lng);
      let diffraction = 0;
      if (dem && dist > 50) {
        const rxElev = (dem.sample(lng, lat) ?? 0) + rxHeight;
        const profile = buildProfile(t, { lng, lat }, dist, dem);
        diffraction = deygoutLossDb(profile, txElevs[ti], rxElev, params.freqMHz, dist);
      }
      const clutterDb = landcover ? clutterDbForClass(landcover.sample(lng, lat)) : params.clutterDb || 0;
      maxDbm = Math.max(maxDbm, receivedDbm(params, dist, diffraction, clutterDb));
    }
    classes[rowOff + c] = classifyDbm(maxDbm, thresholds, floorDbm);
  }
  // progress report unchanged
}
```

This change is backwards-compatible: if `txs` is absent or empty, the `txList` contains only the original `tx` and behavior is identical to before. The painter (`coverage.js`) and stats work unchanged.

---

## Step 6 — UI

### HTML additions (`index.html`)

Add a `<section>` in the left panel, below the Coverage section and above the Drone section:

```html
<!-- ── M3 Site recommendation ──────────────────────── -->
<section class="panel__section" id="siteSection">
  <h3 class="panel__sectionhead">Site recommendation</h3>

  <div class="field-row">
    <label class="field-label" for="maxSites">Max sites</label>
    <input class="input input--num" id="maxSites" type="number" min="1" max="6" value="3">
  </div>
  <div class="field-row">
    <label class="field-label" for="targetCoverage">Target coverage %</label>
    <input class="input input--num" id="targetCoverage" type="number" min="10" max="100" value="95">
  </div>

  <button class="btn btn--primary btn--block" id="recommendBtn" disabled>
    Recommend sites
  </button>

  <div id="siteResults" hidden>
    <ul class="site-list" id="siteList" aria-label="Recommended sites"></ul>
    <p class="help-text" id="siteHelp"></p>
    <button class="btn btn--ghost btn--sm" id="clearSitesBtn">Clear sites</button>
  </div>
</section>
```

### JavaScript additions (`src/main.js`)

Import and wire up a `createRecommendController` (new module `src/recommend/recommend.js`):

```js
import { createRecommendController } from './recommend/recommend.js';
// ...
// Inside whenStyleReady():
const recommender = createRecommendController(map, coverage, {
  onProgress(frac, phase) { /* reuse existing progress bar */ },
  onDone(sites) {
    // Render site-list rows; enable siteResults; place draggable markers
  },
  onStatus(msg) { statusMode.textContent = msg; },
});

recommendBtn.addEventListener('click', () => {
  const area = aoi?.getAoi?.();
  if (!area) return;
  recommender.recommend(area, coverageParams(), {
    maxSites: clampNum($('#maxSites').value, 1, 6, 3),
    targetFrac: clampNum($('#targetCoverage').value, 1, 100, 95) / 100,
  });
});

clearSitesBtn.addEventListener('click', () => recommender.clear());
```

### `src/recommend/recommend.js` — controller module

Owns the worker, the draggable markers, and the results list. Key responsibilities:

- Spawn `src/workers/recommend.worker.js` lazily on first call.
- On `done`: place numbered teal `maplibregl.Marker({ draggable: true })` elements, render the site list.
- On `dragend` (debounced 300 ms): call `coverage.compute()` with `txs` = current site positions. **No re-running greedy** — the user's placement wins.
- `clear()`: remove markers, hide results, clear coverage raster.

### Marker HTML element

```html
<div class="site-marker" data-n="1">1</div>
```

CSS: circle, `--accent` fill, white number, `cursor: grab`. `data-n` drives the hover highlight between list row and marker.

### Site list row example

```
#1 · Kopenberg 248 m · +62% new · cum 62%
#2 · Valserberg 201 m · +23% new · cum 85%
#3 · AOI centre 124 m · +7% new · cum 92%
```

Tabular figures; hover → highlight marker; click row → `map.flyTo` to that site.

One-line explanation below the list (fill in dynamically):
> Sites sit on local high ground; model is talk-in at 1.5 m. Planning-grade — not survey-grade.

---

## Edge cases and constraints

| Situation | Behaviour |
|---|---|
| AOI cleared after recommendation | Invalidate sites immediately (call `recommender.clear()` in AOI `onChange`) |
| AOI > ~10 000 km² | Warn in `siteHelp`; cap demand grid at 28×28 before masking |
| DEM unavailable | Flat fallback; `siteHelp` notes "Terrain unavailable — flat estimate"; sites still appear |
| Drag into a valley | Raster + stats recompute; cum % may drop; no greedy re-run |
| < 2 demand points inside AOI | Worker returns `[]`; UI says "AOI too small" |
| All coordinates stay in-browser | Assert: never `fetch()` coordinates. DEM/worldcover fetches use bounding box tiles only (no site-specific requests that reveal position) |

---

## Shared modules — import map

```
src/workers/profile.js          ← new (extracted from coverage.worker.js)
src/workers/dem.js              ← existing, unchanged
src/workers/worldcover.js       ← existing, unchanged
src/coverage/model.js           ← existing, unchanged
src/workers/coverage.worker.js  ← modified (import profile.js; add txs[] support)
src/workers/recommend.worker.js ← new
src/recommend/recommend.js      ← new (controller, main thread)
```

---

## Acceptance criteria

1. Draw a 15 km radius AOI in hilly terrain (e.g. Ardennes at 50.2° N, 5.8° E), defaults → at least 2 of the 3 recommended sites sit on local high ground; combined raster covers ≥ target or an honest stop message appears; list shows per-site `+X% new` and cumulative %.
2. Drag site #2 into a valley → raster + stats recompute within ~3 s; cum % drops; no greedy re-run.
3. Kill the network → flat fallback still recommends (5×5 grid candidates); UI confirms "Terrain unavailable".
4. Polygon AOI (draw an L-shape over a valley) → demand points masked to polygon, sites not placed outside the polygon boundary.
5. Huge AOI (> 10 000 km²) → warning shown, UI stays responsive.
6. Set maxSites = 1 → single best site, raster is single-tx.
7. `window.__gl` exposes `recommender` in DEV mode for automation.
8. Existing single-site coverage and drone relay are unaffected (backward-compat txs[] change verified).
