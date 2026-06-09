/**
 * Path profile + Fresnel zone + link budget (M14) — pure computation, no DOM.
 *
 * Given two geographic points and a DEM sampler, build a terrain cross-section,
 * test first-Fresnel-zone clearance along it, and produce a simple link budget.
 * Shares the FSPL / wavelength physics with the coverage model so a profile and
 * a coverage raster agree on the same band.
 *
 * Directional / planning-grade, NOT survey-grade.
 */

import { haversineM, wavelengthM, fsplDb } from '../coverage/model.js';

/** Fraction of the first Fresnel zone that must stay clear (60% rule of thumb). */
export const FRESNEL_CLEAR_FRAC = 0.6;

/**
 * Build a terrain elevation profile between two points.
 * @param {{ lat, lng }} a  Start point
 * @param {{ lat, lng }} b  End point
 * @param {number} steps    Number of sample points (default 100)
 * @param {{ sample(lng, lat): number }} dem  DEM with .sample → elevation (m ASL)
 * @returns {{ distances: number[], elevations: number[], distanceKm: number, distanceM: number }}
 *   distances:  metres along the path for each sample
 *   elevations: ground elevation at each sample (m ASL)
 */
export function buildPathProfile(a, b, steps = 100, dem) {
  const n = Math.max(2, Math.round(steps));
  const distanceM = haversineM(a.lat, a.lng, b.lat, b.lng);
  const distances = new Array(n);
  const elevations = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Linear interpolation in lat/lng — fine at profile lengths (tens of km).
    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    distances[i] = distanceM * t;
    const e = dem ? dem.sample(lng, lat) : 0;
    elevations[i] = Number.isFinite(e) ? e : 0;
  }
  return { distances, elevations, distanceKm: distanceM / 1000, distanceM };
}

/**
 * First Fresnel zone radius at a point along the path:
 *   r1 = sqrt(λ · d1 · d2 / (d1 + d2))
 * @param {number} d1  distance from transmitter (m)
 * @param {number} d2  distance from receiver (m)
 * @param {number} freqMHz
 * @returns {number} radius in metres (0 at either endpoint)
 */
export function fresnelRadius(d1, d2, freqMHz) {
  const sum = d1 + d2;
  if (d1 <= 0 || d2 <= 0 || sum <= 0) return 0;
  const lambda = wavelengthM(freqMHz);
  return Math.sqrt((lambda * d1 * d2) / sum);
}

/**
 * Check first-Fresnel clearance along the profile. For each sample, clearance is
 * the gap between the terrain and the lower 60% Fresnel boundary below the
 * line-of-sight (LOS) ray from TX tip to RX tip — negative means the terrain
 * intrudes into the protected zone (an obstruction).
 *
 * @param {number[]} elevations  ground elevations (m ASL)
 * @param {number[]} distances   distances along path (m)
 * @param {number}   distanceM   total path length (m)
 * @param {number}   txElev      TX antenna tip elevation (m ASL)
 * @param {number}   rxElev      RX antenna tip elevation (m ASL)
 * @param {number}   freqMHz
 * @returns {{ clearances: number[], minClearance: number, minClearanceIdx: number, obstructed: boolean }}
 */
export function fresnelClearance(elevations, distances, distanceM, txElev, rxElev, freqMHz) {
  const n = elevations.length;
  const clearances = new Array(n);
  let minClearance = Infinity;
  let minClearanceIdx = 0;
  for (let i = 0; i < n; i++) {
    const d1 = distances[i];
    const d2 = distanceM - d1;
    const los = txElev + ((rxElev - txElev) * d1) / (distanceM || 1);
    const r1 = fresnelRadius(d1, d2, freqMHz);
    const lowerBoundary = los - FRESNEL_CLEAR_FRAC * r1;
    const clearance = lowerBoundary - elevations[i]; // +ve = terrain below the zone
    clearances[i] = clearance;
    if (clearance < minClearance) {
      minClearance = clearance;
      minClearanceIdx = i;
    }
  }
  if (!Number.isFinite(minClearance)) minClearance = 0;
  return { clearances, minClearance, minClearanceIdx, obstructed: minClearance < 0 };
}

/**
 * Simple two-end link budget.
 *   rxSignal = EIRP − FSPL − diffraction
 *   margin   = rxSignal − rxThreshold
 * @returns {{ fsplDb, diffractionDb, eirpDbm, rxSignalDbm, marginDb, viable: boolean }}
 */
export function linkBudget({ distanceM, freqMHz, txEirpDbm, rxThreshDbm, diffractionDb = 0 }) {
  const fspl = fsplDb(distanceM, freqMHz);
  const rxSignalDbm = txEirpDbm - fspl - diffractionDb;
  const marginDb = rxSignalDbm - rxThreshDbm;
  return {
    fsplDb: fspl,
    diffractionDb,
    eirpDbm: txEirpDbm,
    rxSignalDbm,
    marginDb,
    viable: marginDb >= 0,
  };
}
