/**
 * Transmit antenna model — gain, horizontal beamwidth, pointing and
 * front-to-back ratio, with presets for common field antennas.
 *
 * Horizontal pattern: the 3GPP TR 36.814 parabolic model,
 *   A(φ) = min(12 · (φ / φ3dB)², FB)   dB below the main lobe,
 * where φ is the angle off the pointing direction and φ3dB the full
 * half-power beamwidth (so the edge of the beam, φ = φ3dB/2, is −3 dB).
 * Omni antennas (beamwidth ≥ 360°) have no horizontal loss. The vertical
 * pattern is not modelled: cells at the horizon dominate ground coverage and
 * the presets are typical low-tilt antennas.
 *
 * Pure; shared by the coverage worker and the UI.
 */

/** Presets: typical catalogue values, not a specific product. */
export const ANTENNA_PRESETS = Object.freeze({
  dipole: { label: 'Dipole / whip (omni)', gainDbi: 2.15, beamwidthDeg: 360, fbDb: 0 },
  collinear: { label: 'Collinear (omni, 6 dBi)', gainDbi: 6, beamwidthDeg: 360, fbDb: 0 },
  yagi3: { label: 'Yagi 3-element', gainDbi: 7, beamwidthDeg: 70, fbDb: 15 },
  yagi5: { label: 'Yagi 5-element', gainDbi: 10, beamwidthDeg: 50, fbDb: 20 },
  sector90: { label: 'Sector 90°', gainDbi: 12, beamwidthDeg: 90, fbDb: 25 },
  panel60: { label: 'Panel 60°', gainDbi: 14, beamwidthDeg: 60, fbDb: 25 },
});

export const DEFAULT_ANTENNA = Object.freeze({ preset: 'dipole', ...ANTENNA_PRESETS.dipole, azimuthDeg: 0 });

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Clamp/fill an antenna description so the worker can trust it. */
export function normalizeAntenna(a = {}) {
  const base = ANTENNA_PRESETS[a.preset] ?? DEFAULT_ANTENNA;
  return {
    preset: ANTENNA_PRESETS[a.preset] ? a.preset : (a.preset === 'custom' ? 'custom' : DEFAULT_ANTENNA.preset),
    gainDbi: num(a.gainDbi, -10, 30, base.gainDbi),
    beamwidthDeg: num(a.beamwidthDeg, 5, 360, base.beamwidthDeg),
    fbDb: num(a.fbDb, 0, 40, base.fbDb),
    azimuthDeg: ((num(a.azimuthDeg, -360, 720, 0) % 360) + 360) % 360,
  };
}

export const isOmni = (a) => !a || a.beamwidthDeg >= 360;

/** Initial bearing (° from north, clockwise) from point 1 to point 2. */
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δλ = (lng2 - lng1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
}

/** Smallest angle (0–180°) between two bearings. */
export const angleOff = (a, b) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Horizontal pattern loss (dB, ≥ 0) of `antenna` towards `bearing`.
 * 0 for omni antennas and along the pointing direction.
 */
export function patternLossDb(antenna, bearing) {
  if (isOmni(antenna)) return 0;
  const phi = angleOff(bearing, antenna.azimuthDeg);
  return Math.min(12 * (phi / antenna.beamwidthDeg) ** 2, antenna.fbDb);
}

/** Short label for summaries, e.g. "Yagi 5-element 10 dBi → 90°". */
export function antennaText(a) {
  const n = normalizeAntenna(a);
  const name = ANTENNA_PRESETS[n.preset]?.label.replace(/ \(.*\)$/, '') ?? 'Custom antenna';
  const gain = `${+n.gainDbi.toFixed(2)} dBi`;
  return isOmni(n) ? `${name} ${gain}` : `${name} ${gain} → ${Math.round(n.azimuthDeg)}°`;
}
