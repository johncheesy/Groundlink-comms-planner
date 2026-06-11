/**
 * M20 §3 — analysis result summary. Pure + DOM-free: from the painted
 * coverage class grid (the same Uint8Array the controller hands to onPaint;
 * row 0 = north, col 0 = west; classes 0–4, 255 = transparent/below-floor)
 * plus the AOI shape, derive the result-card figures:
 *
 *   { coveredPct, deadZones: [{ centroid:{lng,lat}, areaKm2, cells }],
 *     weakestDbm, weakestBelow }
 *
 * Covered = class ≤ 2 (excellent/good/marginal), the painter's "usable" rule.
 * Dead zones = 8-connected components of non-covered cells inside the AOI,
 * ranked by area, top 5. The worker grid carries classes, not dBm, so the
 * weakest link reports the lower bound of the worst class present
 * (weakestBelow = true when cells sit under the "none" threshold).
 */
import { inAoi } from '../geo/aoi-mask.js';

const KM_PER_DEG = 111.32; // at the equator; lng scaled by cos(lat)
const MAX_ZONES = 5;

export function summarizeCoverage({ classes, cols, rows, bounds, aoi = null, thresholds }) {
  const { west, south, east, north } = bounds;
  const cellW = (east - west) / cols;
  const cellH = (north - south) / rows;
  const lngAt = (c) => west + (c + 0.5) * cellW;
  const latAt = (r) => north - (r + 0.5) * cellH;

  // One pass: AOI membership, covered count, worst class.
  const inside = new Uint8Array(cols * rows);
  let inCells = 0;
  let covered = 0;
  let worst = -1; // class index; 5 stands for class-4/transparent (below "none")
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inAoi(aoi, lngAt(c), latAt(r))) continue;
      inside[i] = 1;
      inCells += 1;
      const cls = classes[i];
      const eff = cls > 4 ? 5 : cls === 4 ? 5 : cls; // 255 + class 4 = below "none"
      if (eff > worst) worst = eff;
      if (cls <= 2) covered += 1;
    }
  }

  // Dead zones: 8-neighbour flood fill over non-covered in-AOI cells.
  const seen = new Uint8Array(cols * rows);
  const zones = [];
  const stack = [];
  for (let start = 0; start < classes.length; start++) {
    if (!inside[start] || seen[start] || classes[start] <= 2) continue;
    let cells = 0;
    let sumLng = 0;
    let sumLat = 0;
    let sumCosLat = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const r = Math.floor(i / cols);
      const c = i % cols;
      cells += 1;
      const lat = latAt(r);
      sumLng += lngAt(c);
      sumLat += lat;
      sumCosLat += Math.cos((lat * Math.PI) / 180);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (seen[ni] || !inside[ni] || classes[ni] <= 2) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const cellKm2 = cellH * KM_PER_DEG * (cellW * KM_PER_DEG * (sumCosLat / cells));
    zones.push({
      centroid: { lng: sumLng / cells, lat: sumLat / cells },
      areaKm2: cells * cellKm2,
      cells,
    });
  }
  zones.sort((a, b) => b.areaKm2 - a.areaKm2);

  // Worst class → its threshold lower bound. 5 = below the "none" threshold.
  const boundByClass = [thresholds.excellent, thresholds.good, thresholds.marginal, thresholds.none];
  const weakestBelow = worst >= 5;
  const weakestDbm = weakestBelow ? thresholds.none : boundByClass[Math.max(worst, 0)];

  return {
    coveredPct: inCells ? (covered / inCells) * 100 : 0,
    deadZones: zones.slice(0, MAX_ZONES),
    weakestDbm,
    weakestBelow,
  };
}
