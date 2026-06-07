/**
 * Coverage physics — FSPL + Deygout knife-edge fallback model.
 *
 * This is the always-available "fallback path" from docs/M2-propagation.md:
 *   received = EIRP − FSPL(d,f) − diffraction(Deygout) − clutter + Rx gain
 * with a k = 4/3 effective-earth radius for the terrain geometry.
 *
 * Pure functions only — no DOM, no Leaflet — so this module is shared verbatim
 * by the Web Worker. When no terrain sampler is supplied the diffraction term
 * is 0 (flat earth → straight FSPL), which is the instant zero-data plot.
 *
 * Directional / planning-grade, NOT survey-grade. ITM/Longley-Rice (WASM) will
 * replace the core in a later step; this stays as the fallback.
 */

export const EARTH_R = 6371008.8; // mean earth radius, metres
export const K_FACTOR = 4 / 3; // standard effective-earth factor
export const EFFECTIVE_EARTH_R = EARTH_R * K_FACTOR;

const LIGHT = 299792458; // m/s

/** Default received-signal class thresholds (dBm), VHF preset. Editable. */
export const DEFAULT_THRESHOLDS = {
  excellent: -85,
  good: -95,
  marginal: -103,
  none: -110,
};

/** Below this received level we treat coverage as nothing → transparent. */
export const DEFAULT_FLOOR_DBM = -120;

/** Class indices map 1:1 to the --s1..--s5 signal-scale tokens. */
export const COVERAGE_CLASS = {
  EXCELLENT: 0,
  GOOD: 1,
  MARGINAL: 2,
  POOR: 3, // the -103..-110 "transition" band
  NONE: 4, // -110..floor
  TRANSPARENT: 255, // below floor — not painted
};

const log10 = (x) => Math.log(x) / Math.LN10;

/** Watts → dBm. */
export const wattsToDbm = (w) => 10 * log10(Math.max(w, 1e-9) * 1000);
/** dBm → Watts. */
export const dbmToWatts = (dbm) => 10 ** (dbm / 10) / 1000;

/**
 * Free-space path loss in dB.
 * FSPL = 20·log10(d) + 20·log10(f) + 20·log10(4π/c), with d in m, f in Hz.
 * In the common engineering form (km, MHz): 32.44 + 20log10(dKm) + 20log10(fMHz).
 */
export function fsplDb(distM, freqMHz) {
  const d = Math.max(distM, 1); // avoid log(0) at the transmitter
  const f = freqMHz * 1e6;
  return 20 * log10(d) + 20 * log10(f) + 20 * log10((4 * Math.PI) / LIGHT);
}

/** Wavelength (m) for a frequency in MHz. */
export const wavelengthM = (freqMHz) => LIGHT / (freqMHz * 1e6);

/**
 * Maximum free-space range (m) — the distance at which FSPL alone drives the
 * received level down to `floorDbm`. This is a conservative upper bound (no
 * terrain/diffraction loss), used to size the compute window so the raster is
 * clipped by the signal physics rather than the AOI bounding box.
 *
 * Solve FSPL(d) = eirp + rxGain − floor for d:
 *   20·log10(d) = budget  →  d = 10^(budget/20)
 */
export function maxRangeM({ eirpDbm, freqMHz, rxGainDbi = 0, floorDbm = DEFAULT_FLOOR_DBM }) {
  const budget =
    eirpDbm + rxGainDbi - floorDbm
    - 20 * log10(freqMHz * 1e6)
    - 20 * log10((4 * Math.PI) / LIGHT);
  return Math.pow(10, budget / 20);
}

/**
 * Single dominant knife-edge diffraction loss (Deygout 1st order), in dB.
 *
 * Given the terminal heights and the worst obstruction along the profile,
 * compute the Fresnel-Kirchhoff parameter v and the ITU-R P.526 J(v)
 * approximation. Returns 0 when the path has clearance (v ≤ -0.78) or when no
 * profile is supplied (flat-earth fallback).
 *
 * @param profile array of { d (m from tx), h (terrain elevation m) } samples,
 *                or null/empty for flat earth.
 * @param txElev  tx ground elevation (m) + antenna height already added
 * @param rxElev  rx ground elevation (m) + antenna height already added
 * @param freqMHz frequency
 */
export function deygoutLossDb(profile, txElev, rxElev, freqMHz, totalDistM) {
  if (!profile || profile.length === 0) return 0;
  const lambda = wavelengthM(freqMHz);

  // Find the obstruction with the greatest Fresnel parameter v.
  let vMax = -Infinity;
  for (const p of profile) {
    const d1 = p.d;
    const d2 = totalDistM - p.d;
    if (d1 <= 0 || d2 <= 0) continue;
    // Line-of-sight height at this point (linear interp + earth bulge already
    // folded into terrain via effective-earth sampling by the caller).
    const losHeight = txElev + ((rxElev - txElev) * d1) / totalDistM;
    const clearance = p.h - losHeight; // +ve = obstruction above LOS
    const v = clearance * Math.sqrt((2 * totalDistM) / (lambda * d1 * d2));
    if (v > vMax) vMax = v;
  }
  return knifeEdgeJ(vMax);
}

/** ITU-R P.526 knife-edge loss approximation J(v), dB (0 for v ≤ -0.78). */
export function knifeEdgeJ(v) {
  if (!isFinite(v) || v <= -0.78) return 0;
  return 6.9 + 20 * log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
}

/** Effective-earth bulge (m) at intermediate point, k = 4/3. */
export function earthBulgeM(d1, d2) {
  return (d1 * d2) / (2 * EFFECTIVE_EARTH_R);
}

/**
 * Received signal (dBm) at distance distM from the transmitter.
 * Optional diffraction + clutter losses (dB) default to 0.
 */
export function receivedDbm({ eirpDbm, freqMHz, rxGainDbi = 0 }, distM, diffractionDb = 0, clutterDb = 0) {
  return eirpDbm - fsplDb(distM, freqMHz) + rxGainDbi - diffractionDb - clutterDb;
}

/** Classify a received level (dBm) into a COVERAGE_CLASS index. */
export function classifyDbm(dbm, thresholds = DEFAULT_THRESHOLDS, floorDbm = DEFAULT_FLOOR_DBM) {
  if (dbm >= thresholds.excellent) return COVERAGE_CLASS.EXCELLENT;
  if (dbm >= thresholds.good) return COVERAGE_CLASS.GOOD;
  if (dbm >= thresholds.marginal) return COVERAGE_CLASS.MARGINAL;
  if (dbm >= thresholds.none) return COVERAGE_CLASS.POOR;
  if (dbm >= floorDbm) return COVERAGE_CLASS.NONE;
  return COVERAGE_CLASS.TRANSPARENT;
}

/** Great-circle distance (m) between two {lat,lng} points (haversine). */
export function haversineM(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}
