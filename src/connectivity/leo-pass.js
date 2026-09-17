/**
 * M48 — LEO/MEO pass engine (SGP4).
 *
 * Pure functions, no DOM, no network. Given a set of two-line elements
 * (TLEs) and an observer position, computes look angles and a short
 * planning window: how many satellites of a constellation are above the
 * elevation mask right now, the worst moment in the next N minutes, any
 * gaps with nothing above the mask, and the next pass when nothing is
 * visible now.
 *
 * Propagation is SGP4 via `satellite.js` (MIT). This module is imported
 * lazily by the satcom panel so the SGP4 code is a separate Vite chunk and
 * never lands in the eager bundle.
 *
 * Pass-window scan pattern adapted from God's Eye View `src/data/issPass.js`
 * (MIT, © 2026 Bilawal Sidhu), generalised from one satellite to a
 * constellation with gap and availability accounting.
 *
 * Accuracy: SGP4 on fresh CelesTrak elements is good to a few km, i.e. well
 * under 1° of elevation for LEO. Terrain masking is NOT included — same
 * caveat as the GEO look angles (confirm with the path profile, M14).
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  eciToGeodetic,
} from 'satellite.js';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/**
 * Parse CelesTrak "TLE" text (3-line with name, or bare 2-line sets).
 * Lines that are not part of a valid 1/2 pair are ignored.
 * @param {string} text
 * @returns {Array<{ name: string, line1: string, line2: string }>}
 */
export function parseTle(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const sats = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i];
    const l2 = lines[i + 1];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    const hasName = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ');
    const name = hasName ? prev : l1.slice(2, 7).trim();
    sats.push({ name, line1: l1, line2: l2 });
    i++; // consumed line 2
  }
  return sats;
}

/**
 * Build satrecs from parsed TLEs, dropping any set SGP4 rejects.
 * @param {Array<{ name: string, line1: string, line2: string }>} tles
 * @returns {Array<{ name: string, satrec: object }>}
 */
export function toSatrecs(tles) {
  const out = [];
  for (const t of tles) {
    try {
      const satrec = twoline2satrec(t.line1, t.line2);
      if (satrec && !satrec.error) out.push({ name: t.name, satrec });
    } catch (_) { /* skip malformed set */ }
  }
  return out;
}

/** Epoch of a satrec as a JS timestamp (ms). */
export function satrecEpochMs(satrec) {
  // jdsatepoch is a Julian date; JD 2440587.5 = 1970-01-01T00:00Z
  return (satrec.jdsatepoch - 2440587.5) * 86_400_000;
}

/**
 * Sub-satellite point at an instant (used by tests and for debugging).
 * @returns {{ latDeg: number, lngDeg: number, heightKm: number } | null}
 */
export function subpointAt(satrec, dateMs) {
  const date = new Date(dateMs);
  let pv;
  try { pv = propagate(satrec, date); } catch (_) { return null; }
  const pos = pv && pv.position;
  if (!pos || typeof pos === 'boolean') return null;
  const g = eciToGeodetic(pos, gstime(date));
  return {
    latDeg: g.latitude * R2D,
    lngDeg: (((g.longitude * R2D) + 540) % 360) - 180,
    heightKm: g.height,
  };
}

/**
 * Observer look angles to one satellite at an instant.
 * @returns {{ elevDeg: number, azDeg: number, rangeKm: number } | null}
 *   null when propagation fails (decayed set, bad elements).
 */
export function lookAnglesAt(satrec, dateMs, latDeg, lngDeg, heightKm = 0) {
  const date = new Date(dateMs);
  let pv;
  try { pv = propagate(satrec, date); } catch (_) { return null; }
  const pos = pv && pv.position;
  if (!pos || typeof pos === 'boolean') return null;
  const ecf = eciToEcf(pos, gstime(date));
  const look = ecfToLookAngles(
    { latitude: latDeg * D2R, longitude: lngDeg * D2R, height: heightKm },
    ecf,
  );
  return {
    elevDeg: look.elevation * R2D,
    azDeg: (((look.azimuth * R2D) % 360) + 360) % 360,
    rangeKm: look.rangeSat,
  };
}

/**
 * Planning window for a constellation from one observer position.
 *
 * Samples every `stepSec` over `horizonMin` minutes. At each sample the
 * best (highest-elevation) satellite and the count above `maskDeg` are
 * recorded. Cost ≈ sats × samples SGP4 propagations (Iridium, 80 sats,
 * 2 h at 60 s ≈ 9.7k propagations — tens of ms).
 *
 * @param {object} p
 * @param {Array<{ name: string, satrec: object }>} p.sats
 * @param {number} p.latDeg
 * @param {number} p.lngDeg
 * @param {number} [p.fromMs=Date.now()]
 * @param {number} [p.horizonMin=120]
 * @param {number} [p.stepSec=60]
 * @param {number} [p.maskDeg=10]   elevation mask (handheld L-band: ~10°)
 * @returns {{
 *   fromMs: number, horizonMin: number, stepSec: number, maskDeg: number,
 *   satCount: number,
 *   nowVisible: number,
 *   bestNow: { name: string, elevDeg: number, azDeg: number } | null,
 *   worst: { tMs: number, elevDeg: number, name: string } | null,
 *   gaps: Array<{ startMs: number, endMs: number, openEnded: boolean }>,
 *   longestGapMin: number,
 *   availabilityPct: number,
 *   nextPass: { riseMs: number, setMs: number | null, peakMs: number, peakElevDeg: number, name: string } | null,
 * }}
 */
export function constellationWindow({
  sats,
  latDeg,
  lngDeg,
  fromMs = Date.now(),
  horizonMin = 120,
  stepSec = 60,
  maskDeg = 10,
}) {
  const stepMs = Math.max(1, stepSec) * 1000;
  const endMs = fromMs + horizonMin * 60_000;
  const n = Math.max(1, Math.floor((horizonMin * 60) / Math.max(1, stepSec)) + 1);

  const samples = new Array(n);
  for (let k = 0; k < n; k++) {
    const tMs = fromMs + k * stepMs;
    let best = null;
    let visible = 0;
    for (const s of sats) {
      const la = lookAnglesAt(s.satrec, tMs, latDeg, lngDeg);
      if (!la) continue;
      if (la.elevDeg >= maskDeg) visible++;
      if (!best || la.elevDeg > best.elevDeg) {
        best = { name: s.name, elevDeg: la.elevDeg, azDeg: la.azDeg };
      }
    }
    samples[k] = { tMs, best, visible };
  }

  const now = samples[0];

  // Worst moment = sample whose best satellite is lowest.
  let worst = null;
  for (const s of samples) {
    if (!s.best) continue;
    if (!worst || s.best.elevDeg < worst.best.elevDeg) worst = s;
  }

  // Gaps = contiguous runs with nothing above the mask.
  const gaps = [];
  let gapStart = null;
  for (const s of samples) {
    if (s.visible === 0) {
      if (gapStart == null) gapStart = s.tMs;
    } else if (gapStart != null) {
      gaps.push({ startMs: gapStart, endMs: s.tMs, openEnded: false });
      gapStart = null;
    }
  }
  if (gapStart != null) gaps.push({ startMs: gapStart, endMs, openEnded: true });
  const longestGapMin = gaps.reduce(
    (m, g) => Math.max(m, (g.endMs - g.startMs) / 60_000), 0);

  // Next pass — only meaningful when nothing is above the mask now.
  let nextPass = null;
  if (now.visible === 0) {
    const idx = samples.findIndex((s) => s.visible > 0);
    if (idx > 0) {
      let peak = samples[idx];
      let j = idx;
      while (j < n && samples[j].visible > 0) {
        if (samples[j].best.elevDeg > peak.best.elevDeg) peak = samples[j];
        j++;
      }
      nextPass = {
        riseMs: samples[idx].tMs,
        setMs: j < n ? samples[j].tMs : null,
        peakMs: peak.tMs,
        peakElevDeg: peak.best.elevDeg,
        name: peak.best.name,
      };
    }
  }

  const covered = samples.reduce((c, s) => c + (s.visible > 0 ? 1 : 0), 0);

  return {
    fromMs,
    horizonMin,
    stepSec,
    maskDeg,
    satCount: sats.length,
    nowVisible: now.visible,
    bestNow: now.best,
    worst: worst ? { tMs: worst.tMs, elevDeg: worst.best.elevDeg, name: worst.best.name } : null,
    gaps,
    longestGapMin,
    availabilityPct: (100 * covered) / n,
    nextPass,
  };
}
