/**
 * Site-recommendation Web Worker (M3 + M4).
 *
 * Given a demand set and link params, proposes N mast positions that together
 * cover the demand. Pipeline:
 *   1. demand        — explicit points (M4 mission) OR an AOI-masked grid (M3)
 *   2. data fetch    — DEM (+ optional clutter) over the padded bbox
 *   3. candidates    — DEM local maxima (high ground) + the AOI/bbox centroid
 *   4. scoring       — point-to-point received dBm, candidate × demand matrix
 *   5. greedy cover  — seed coverage from any locked (fixed) sites, then
 *                      repeatedly pick the candidate adding the most new cover
 *
 * Reuses the M2 physics verbatim (FSPL + Deygout over the DEM, k = 4/3). All
 * heavy work is off the main thread. OPSEC: only bbox tiles are fetched — no
 * request ever carries a site/demand coordinate.
 *
 * Message in:
 *   { type:'recommend', id, bounds, aoi:{type,center,radiusM,ring}|null,
 *     demand:[{lat,lng}]|null,            // explicit mission demand (M4)
 *     lockedSites:[{lat,lng,name}]|null,  // fixed infrastructure (pre-placed tx)
 *     params }
 * Messages out:
 *   { type:'progress', id, done, total, phase:'data'|'score'|'cover' }
 *   { type:'done', id, sites:[{lat,lng,elevM,label,newlyCovered,cumulativeFrac}],
 *       terrain, clutter, lockedCount, baseFrac, demandCount }
 *   { type:'error', id, message }
 */
import { receivedDbm, classifyDbm, haversineM, deygoutLossDb } from '../coverage/model.js';
import { buildProfile } from './profile.js';
import { buildElevationSampler, buildClutterSampler } from '../data/sources.js';
import { demandGrid, padBounds, diagonalM } from '../geo/aoi-mask.js';
import { createYielder } from './yield.js';

// Cancellation — mirrors coverage.worker.js: a newer 'recommend' bumps
// `activeId`, a 'cancel' (clear()) sets `cancelled`; the scoring loop yields so
// they're delivered, then early-exits instead of finishing a superseded job.
let activeId = 0;
let cancelled = false;
const yieldToEventLoop = createYielder();

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg?.type === 'cancel') { cancelled = true; return; }
  if (msg?.type !== 'recommend') return;
  const { id, bounds, aoi, params } = msg;
  activeId = id;
  cancelled = false;
  const aborted = () => id !== activeId || cancelled;
  const lockedSites = msg.lockedSites || [];

  try {
    // ── 1. Demand: explicit mission points, else an AOI-masked grid ─────
    const demand =
      msg.demand && msg.demand.length >= 2 ? msg.demand : demandGrid(bounds, aoi, 28);
    if (demand.length < 2) {
      self.postMessage({ type: 'done', id, sites: [], terrain: false, clutter: false, lockedCount: 0, baseFrac: 0, demandCount: demand.length });
      return;
    }

    // ── 2. Data: DEM (+ clutter) over a padded bbox, fetched once ───────
    self.postMessage({ type: 'progress', id, done: 0, total: 1, phase: 'data' });
    const padded = padBounds(bounds, 0.1);
    // E1 source interfaces — site search keeps the network/OPFS defaults
    // (no per-run COG files here; the final raster paint honours them).
    const [dem, clutter] = await Promise.all([
      params.useTerrain ? buildElevationSampler({ bounds: padded }).catch(() => null) : Promise.resolve(null),
      params.useClutter ? buildClutterSampler({ bounds: padded }).catch(() => null) : Promise.resolve(null),
    ]);
    const terrain = !!dem;
    if (aborted()) return; // superseded/cancelled while fetching tiles
    self.postMessage({ type: 'progress', id, done: 1, total: 1, phase: 'data' });

    // Centroid source — the AOI centre when present, else the bbox centre so
    // route/points-only missions still get a sensible fallback candidate.
    const centre = aoi?.center ?? {
      lat: (bounds.south + bounds.north) / 2,
      lng: (bounds.west + bounds.east) / 2,
    };

    // Reusable scorer: which demand points does a transmitter here cover?
    const txHeightM = params.txHeightM;
    function coverageRow(txLng, txLat) {
      const txElev = (dem ? dem.sample(txLng, txLat) : 0) + txHeightM;
      const row = new Uint8Array(demand.length);
      for (let di = 0; di < demand.length; di++) {
        const pt = demand[di];
        const dist = haversineM(txLat, txLng, pt.lat, pt.lng);
        let diffraction = 0;
        if (dem && dist > 50) {
          const rxElev = dem.sample(pt.lng, pt.lat) + params.rxHeightM;
          diffraction = deygoutLossDb(buildProfile({ lng: txLng, lat: txLat }, pt, dist, dem), txElev, rxElev, params.freqMHz, dist);
        }
        const clutterDb = clutter ? clutter.dbAt(pt.lng, pt.lat) : (params.clutterDb ?? 0);
        const dbm = receivedDbm(params, dist, diffraction, clutterDb);
        row[di] = classifyDbm(dbm, params.thresholds, params.floorDbm) <= 2 ? 1 : 0; // marginal+ = covered
      }
      return row;
    }

    // ── 3. Candidate generation (DEM local maxima + centroid) ──────────
    const candidates = generateCandidates(padded, centre, dem);
    if (aborted()) return;

    // ── 4. Point-to-point scoring (candidate × demand coverage matrix) ──
    // The heaviest phase (profile build per candidate × demand); yield a few
    // times so a superseded run aborts instead of scoring the whole matrix.
    const coverageMatrix = new Array(candidates.length);
    const scoreYieldEvery = Math.max(1, Math.floor(candidates.length / 8));
    for (let ci = 0; ci < candidates.length; ci++) {
      coverageMatrix[ci] = coverageRow(candidates[ci].lng, candidates[ci].lat);
      self.postMessage({ type: 'progress', id, done: ci + 1, total: candidates.length, phase: 'score' });
      if ((ci + 1) % scoreYieldEvery === 0 && ci < candidates.length - 1) {
        await yieldToEventLoop();
        if (aborted()) return;
      }
    }

    // ── 5. Greedy set-cover — seed from locked (fixed) sites first ─────
    const covered = new Uint8Array(demand.length);
    let totalCovered = 0;
    for (const ls of lockedSites) {
      const row = coverageRow(ls.lng, ls.lat);
      for (let di = 0; di < demand.length; di++) {
        if (!covered[di] && row[di]) { covered[di] = 1; totalCovered++; }
      }
    }
    const baseFrac = totalCovered / demand.length; // coverage from fixed sites alone

    const maxSites = params.maxSites ?? 3;
    const targetFrac = params.targetFrac ?? 0.95;
    const chosen = [];

    self.postMessage({ type: 'progress', id, done: 0, total: maxSites, phase: 'cover' });

    if (baseFrac < targetFrac) {
      for (let pick = 0; pick < maxSites; pick++) {
        if (aborted()) return;
        let bestIdx = -1;
        let bestNew = 0;
        for (let ci = 0; ci < candidates.length; ci++) {
          if (candidates[ci]._picked) continue;
          const row = coverageMatrix[ci];
          let newCount = 0;
          for (let di = 0; di < demand.length; di++) {
            if (!covered[di] && row[di]) newCount++;
          }
          if (newCount > bestNew) { bestNew = newCount; bestIdx = ci; }
        }

        // Stop if the best remaining candidate adds < 2 % of demand points.
        if (bestIdx === -1 || bestNew < demand.length * 0.02) break;

        const row = coverageMatrix[bestIdx];
        for (let di = 0; di < demand.length; di++) {
          if (!covered[di] && row[di]) { covered[di] = 1; totalCovered++; }
        }
        candidates[bestIdx]._picked = true;
        const cand = candidates[bestIdx];
        chosen.push({
          lat: cand.lat,
          lng: cand.lng,
          elevM: cand.elevM,
          label: cand.label,
          newlyCovered: bestNew / demand.length,
          cumulativeFrac: totalCovered / demand.length,
        });

        self.postMessage({ type: 'progress', id, done: pick + 1, total: maxSites, phase: 'cover' });
        if (totalCovered / demand.length >= targetFrac) break;
      }
    }

    self.postMessage({
      type: 'done', id, sites: chosen, terrain, clutter: !!clutter,
      lockedCount: lockedSites.length, baseFrac, demandCount: demand.length,
    });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};

// ── Candidate generation ────────────────────────────────────────────────────

/**
 * DEM local maxima over a 64×64 grid of the padded bbox, separation-filtered
 * (keep the strongest per cluster), top 30 by elevation + the centroid.
 * Without a DEM: a 5×5 grid + centroid, all at elevation 0.
 */
function generateCandidates(padded, centre, dem) {
  const centroid = {
    lng: centre.lng,
    lat: centre.lat,
    elevM: dem ? dem.sample(centre.lng, centre.lat) : 0,
    label: 'Centre',
  };

  if (!dem) {
    const pts = [];
    for (let r = 0; r < 5; r++) {
      const lat = padded.north - ((r + 0.5) / 5) * (padded.north - padded.south);
      for (let c = 0; c < 5; c++) {
        const lng = padded.west + ((c + 0.5) / 5) * (padded.east - padded.west);
        pts.push({ lng, lat, elevM: 0, label: 'Site' });
      }
    }
    pts.push(centroid);
    return pts;
  }

  const CAND_DIM = 64;
  const lats = new Array(CAND_DIM);
  const lngs = new Array(CAND_DIM);
  for (let r = 0; r < CAND_DIM; r++) lats[r] = padded.north - ((r + 0.5) / CAND_DIM) * (padded.north - padded.south);
  for (let c = 0; c < CAND_DIM; c++) lngs[c] = padded.west + ((c + 0.5) / CAND_DIM) * (padded.east - padded.west);

  const elevGrid = [];
  for (let r = 0; r < CAND_DIM; r++) {
    const row = new Array(CAND_DIM);
    for (let c = 0; c < CAND_DIM; c++) row[c] = dem.sample(lngs[c], lats[r]);
    elevGrid.push(row);
  }

  const candidates = [];
  for (let r = 1; r < CAND_DIM - 1; r++) {
    for (let c = 1; c < CAND_DIM - 1; c++) {
      const h = elevGrid[r][c];
      if (neighbours8(r, c).every(([nr, nc]) => elevGrid[nr][nc] <= h)) {
        candidates.push({ lng: lngs[c], lat: lats[r], elevM: h, label: 'High ground' });
      }
    }
  }

  const minSepM = diagonalM(padded) / 12;
  const filtered = clusterFilter(candidates, minSepM); // keep strongest per cluster
  const top = filtered.sort((a, b) => b.elevM - a.elevM).slice(0, 30);
  top.push(centroid);
  return top;
}

/** Keep the highest-elevation candidate within each `minSepM` cluster. */
function clusterFilter(cands, minSepM) {
  const sorted = [...cands].sort((a, b) => b.elevM - a.elevM);
  const kept = [];
  for (const c of sorted) {
    if (kept.every((k) => haversineM(k.lat, k.lng, c.lat, c.lng) >= minSepM)) kept.push(c);
  }
  return kept;
}

function neighbours8(r, c) {
  return [
    [r - 1, c - 1], [r - 1, c], [r - 1, c + 1],
    [r, c - 1], [r, c + 1],
    [r + 1, c - 1], [r + 1, c], [r + 1, c + 1],
  ];
}
