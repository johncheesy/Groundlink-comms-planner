/**
 * Site-recommendation Web Worker (M3).
 *
 * Given an AOI and link params, proposes N mast positions that together cover
 * the AOI. Pipeline:
 *   1. demand grid   — handheld rx points inside the AOI (AOI-masked)
 *   2. data fetch    — DEM (+ optional clutter) over the padded bbox
 *   3. candidates    — DEM local maxima (high ground) + the AOI centroid
 *   4. scoring       — point-to-point received dBm, candidate × demand matrix
 *   5. greedy cover  — repeatedly pick the candidate adding the most new cover
 *
 * Reuses the M2 physics verbatim (FSPL + Deygout over the DEM, k = 4/3). All
 * heavy work is off the main thread. OPSEC: only bbox tiles are fetched — no
 * request ever carries a site/demand coordinate.
 *
 * Message in:
 *   { type:'recommend', id, bounds, aoi:{type,center,radiusM,ring}, params }
 * Messages out:
 *   { type:'progress', id, done, total, phase:'data'|'score'|'cover' }
 *   { type:'done', id, sites:[{lat,lng,elevM,label,newlyCovered,cumulativeFrac}],
 *       terrain, clutter }
 *   { type:'error', id, message }
 */
import { receivedDbm, classifyDbm, haversineM, deygoutLossDb } from '../coverage/model.js';
import { buildProfile } from './profile.js';
import { buildDem } from './dem.js';
import { buildLandcover, clutterDbForClass } from './worldcover.js';

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg?.type !== 'recommend') return;
  const { id, bounds, aoi, params } = msg;

  try {
    // ── 1. Demand grid (AOI-masked) ────────────────────────────────────
    const demand = demandGrid(bounds, aoi, 28);
    if (demand.length < 2) {
      self.postMessage({ type: 'done', id, sites: [], terrain: false, clutter: false });
      return;
    }

    // ── 2. Data: DEM (+ clutter) over a padded bbox, fetched once ───────
    self.postMessage({ type: 'progress', id, done: 0, total: 1, phase: 'data' });
    const padded = padBounds(bounds, 0.1);
    const [dem, landcover] = await Promise.all([
      params.useTerrain ? buildDem(padded).catch(() => null) : Promise.resolve(null),
      params.useClutter ? buildLandcover(padded).catch(() => null) : Promise.resolve(null),
    ]);
    const terrain = !!dem;
    self.postMessage({ type: 'progress', id, done: 1, total: 1, phase: 'data' });

    // ── 3. Candidate generation (DEM local maxima + centroid) ──────────
    const candidates = generateCandidates(padded, aoi, dem);

    // ── 4. Point-to-point scoring (candidate × demand coverage matrix) ──
    const coverageMatrix = candidates.map(() => new Uint8Array(demand.length));
    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      const txElev = (dem ? dem.sample(cand.lng, cand.lat) : 0) + params.txHeightM;
      const row = coverageMatrix[ci];
      for (let di = 0; di < demand.length; di++) {
        const pt = demand[di];
        const dist = haversineM(cand.lat, cand.lng, pt.lat, pt.lng);
        let diffraction = 0;
        if (dem && dist > 50) {
          const rxElev = dem.sample(pt.lng, pt.lat) + params.rxHeightM;
          diffraction = deygoutLossDb(buildProfile(cand, pt, dist, dem), txElev, rxElev, params.freqMHz, dist);
        }
        const clutterDb = landcover ? clutterDbForClass(landcover.sample(pt.lng, pt.lat)) : (params.clutterDb ?? 0);
        const dbm = receivedDbm(params, dist, diffraction, clutterDb);
        row[di] = classifyDbm(dbm, params.thresholds, params.floorDbm) <= 2 ? 1 : 0; // marginal+ = covered
      }
      self.postMessage({ type: 'progress', id, done: ci + 1, total: candidates.length, phase: 'score' });
    }

    // ── 5. Greedy set-cover ────────────────────────────────────────────
    const maxSites = params.maxSites ?? 3;
    const targetFrac = params.targetFrac ?? 0.95;
    const chosen = [];
    const covered = new Uint8Array(demand.length);
    let totalCovered = 0;

    self.postMessage({ type: 'progress', id, done: 0, total: maxSites, phase: 'cover' });

    for (let pick = 0; pick < maxSites; pick++) {
      let bestIdx = -1;
      let bestNew = 0;
      for (let ci = 0; ci < candidates.length; ci++) {
        const row = coverageMatrix[ci];
        let newCount = 0;
        for (let di = 0; di < demand.length; di++) {
          if (!covered[di] && row[di]) newCount++;
        }
        if (newCount > bestNew) {
          bestNew = newCount;
          bestIdx = ci;
        }
      }

      // Stop if the best remaining candidate adds < 2 % of demand points.
      if (bestIdx === -1 || bestNew < demand.length * 0.02) break;

      const row = coverageMatrix[bestIdx];
      for (let di = 0; di < demand.length; di++) {
        if (!covered[di] && row[di]) {
          covered[di] = 1;
          totalCovered++;
        }
      }
      const cand = candidates[bestIdx];
      const cumulativeFrac = totalCovered / demand.length;
      chosen.push({
        lat: cand.lat,
        lng: cand.lng,
        elevM: cand.elevM,
        label: cand.label,
        newlyCovered: bestNew / demand.length, // fraction of demand newly covered
        cumulativeFrac,
      });

      self.postMessage({ type: 'progress', id, done: pick + 1, total: maxSites, phase: 'cover' });

      if (cumulativeFrac >= targetFrac) break;
    }

    self.postMessage({ type: 'done', id, sites: chosen, terrain, clutter: !!landcover });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};

// ── Demand grid ───────────────────────────────────────────────────────────

/**
 * Grid of rx (handheld) positions inside the AOI. cols/rows scale with the
 * bbox aspect ratio, capped at maxDim, then masked to the AOI shape → typically
 * 400–700 in-shape points.
 */
function demandGrid(bounds, aoi, maxDim = 28) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const w = Math.abs(east - west) * Math.cos((midLat * Math.PI) / 180);
  const h = Math.abs(north - south);
  let cols, rows;
  if (w >= h) {
    cols = maxDim;
    rows = Math.max(4, Math.round((maxDim * h) / w));
  } else {
    rows = maxDim;
    cols = Math.max(4, Math.round((maxDim * w) / h));
  }

  const points = [];
  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * (north - south);
    for (let c = 0; c < cols; c++) {
      const lng = west + ((c + 0.5) / cols) * (east - west);
      if (inAoi(aoi, lng, lat)) points.push({ lng, lat });
    }
  }
  return points;
}

// ── Candidate generation ────────────────────────────────────────────────────

/**
 * DEM local maxima over a 64×64 grid of the padded bbox, separation-filtered
 * (keep the strongest per cluster), top 30 by elevation + the AOI centroid.
 * Without a DEM: a 5×5 grid + centroid, all at elevation 0.
 */
function generateCandidates(padded, aoi, dem) {
  const centroid = {
    lng: aoi.center.lng,
    lat: aoi.center.lat,
    elevM: dem ? dem.sample(aoi.center.lng, aoi.center.lat) : 0,
    label: 'AOI centre',
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

// ── Geometry helpers ────────────────────────────────────────────────────────

function padBounds(b, frac) {
  const dLng = (b.east - b.west) * frac;
  const dLat = (b.north - b.south) * frac;
  return { west: b.west - dLng, east: b.east + dLng, south: b.south - dLat, north: b.north + dLat };
}

function diagonalM(b) {
  return haversineM(b.south, b.west, b.north, b.east);
}

/** Is (lng, lat) inside the AOI shape? Radius → distance; polygon → ray-cast. */
function inAoi(aoi, lng, lat) {
  if (aoi.type === 'radius') {
    return haversineM(aoi.center.lat, aoi.center.lng, lat, lng) <= aoi.radiusM;
  }
  return pointInRing(aoi.ring, lng, lat);
}

/** Ray-casting point-in-polygon against a ring of [lng, lat] pairs. */
function pointInRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
