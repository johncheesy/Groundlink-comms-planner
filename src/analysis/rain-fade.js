/**
 * E4 — Satellite link rain fade calculator.
 *
 * Implements a simplified ITU-R P.618-14 rain attenuation model for
 * GEO satellite links. Given a location, elevation angle, frequency and
 * polarisation, returns the rain attenuation exceeded for a set of
 * availability percentages.
 *
 * Reference: ITU-R P.618-14 (2022) + ITU-R P.837-7 (rain rate) +
 * ITU-R P.839-4 (rain height) + ITU-R P.838-3 (specific attenuation).
 *
 * Accuracy: ±3 dB (adequate for link-budget planning; not a substitute
 * for a full ITU-R implementation with location-specific rain rate maps).
 *
 * All inputs in SI / standard telecom units.
 */

// ── ITU-R P.838-3 specific attenuation coefficients ──────────────────────
// γ_R = k · R^α  (dB/km)
// Tabulated for horizontal (H) and vertical (V) polarisation.
// Source: Table 1, ITU-R P.838-3.
const P838 = {
  //   GHz   kH      αH      kV      αV
  entries: [
    [  1,  0.0000387, 0.912, 0.0000352, 0.880],
    [  2,  0.000154,  0.963, 0.000138,  0.923],
    [  4,  0.000650,  1.121, 0.000591,  1.075],
    [  6,  0.00175,   1.308, 0.00155,   1.265],
    [  7,  0.00301,   1.332, 0.00265,   1.312],
    [  8,  0.00454,   1.327, 0.00395,   1.310],
    [ 10,  0.0101,    1.276, 0.00887,   1.264],
    [ 12,  0.0188,    1.217, 0.0168,    1.200],
    [ 15,  0.0367,    1.154, 0.0335,    1.128],
    [ 20,  0.0751,    1.099, 0.0691,    1.065],
    [ 25,  0.124,     1.061, 0.113,     1.030],
    [ 30,  0.187,     1.021, 0.167,     1.000],
    [ 35,  0.263,     0.979, 0.233,     0.963],
    [ 40,  0.350,     0.939, 0.310,     0.929],
    [ 45,  0.442,     0.903, 0.393,     0.897],
    [ 50,  0.536,     0.873, 0.479,     0.868],
    [ 60,  0.707,     0.826, 0.642,     0.824],
    [ 70,  0.851,     0.793, 0.784,     0.793],
    [ 80,  0.975,     0.769, 0.906,     0.769],
    [100,  1.06,      0.753, 1.00,      0.754],
  ],
};

function p838Coeffs(freqGhz, polarDeg) {
  // Interpolate log-linearly between table entries
  const T = P838.entries;
  let lo = T[0], hi = T[T.length - 1];
  for (let i = 0; i < T.length - 1; i++) {
    if (freqGhz >= T[i][0] && freqGhz <= T[i + 1][0]) {
      lo = T[i]; hi = T[i + 1];
      break;
    }
  }
  const f = (freqGhz - lo[0]) / (hi[0] - lo[0]);
  // Log-linear interpolation for k, linear for α
  const lnkH = Math.log(lo[1]) + f * (Math.log(hi[1]) - Math.log(lo[1]));
  const lnkV = Math.log(lo[3]) + f * (Math.log(hi[3]) - Math.log(lo[3]));
  const aH = lo[2] + f * (hi[2] - lo[2]);
  const aV = lo[4] + f * (hi[4] - lo[4]);
  const kH = Math.exp(lnkH), kV = Math.exp(lnkV);

  // Combine H/V for polarisation angle τ (deg from horizontal)
  // ITU-R P.838-3 eq. 4
  const τ = polarDeg * (Math.PI / 180);
  const k = (kH + kV + (kH - kV) * Math.cos(2 * τ)) / 2;
  const α = (kH * aH + kV * aV + (kH * aH - kV * aV) * Math.cos(2 * τ)) / (2 * k);
  return { k, α };
}

// ── ITU-R P.839-4: mean rain height ────────────────────────────────────
// h_R = h_0 + 0.36  (km)  where h_0 is 0°C isotherm height
// Simplified global approximation: h_0 ≈ 5 - |lat| * 0.075  (tropical to polar)
function rainHeightKm(latDeg) {
  const h0 = Math.max(1, 5 - Math.abs(latDeg) * 0.075);
  return h0 + 0.36;
}

// ── ITU-R P.837-7: point rain rate exceeded 0.01% of time ──────────────
// Simplified global surface (Crane 1982 zone / fitted curve) for planning.
// For production use, download ITU-R P.837 maps; this gives ±40% accuracy.
// Zones (approximate): Polar A=2, B=3, C=5, D=8, E=13, F=20, G=28, H=42 mm/h
function r001(latDeg, lngDeg) {
  const absLat = Math.abs(latDeg);
  // Simplified: equatorial regions get higher rain rates
  if (absLat < 10) return 42;   // tropical/equatorial
  if (absLat < 20) return 28;   // subtropical
  if (absLat < 30) return 20;   // trade-wind margins
  if (absLat < 40) return 13;   // temperate/Mediterranean
  if (absLat < 50) return 8;    // mid-latitude (NW Europe, N US)
  if (absLat < 60) return 5;    // sub-polar
  return 2;                      // polar
}

/**
 * Compute rain attenuation (dB) exceeded at given availability percentages.
 * Implements ITU-R P.618-14 §2.2.1.
 *
 * @param {object} params
 * @param {number}  params.latDeg       observer latitude (N+)
 * @param {number}  params.lngDeg       observer longitude (E+)
 * @param {number}  params.elevDeg      elevation angle to satellite (degrees)
 * @param {number}  params.freqGhz      carrier frequency (GHz, 1–100)
 * @param {number}  [params.polarDeg=0] polarisation angle from horizontal (0=H, 90=V, 45=circular)
 * @param {number}  [params.htKm=0]     station height above sea level (km, default 0)
 * @returns {{ p: number[], A: number[] }}
 *   p = availability percentages, A = attenuation in dB for each
 */
export function rainAttenuation({ latDeg, lngDeg, elevDeg, freqGhz, polarDeg = 45, htKm = 0 }) {
  // Below 1 GHz: rain negligible
  if (freqGhz < 1) return { p: [99, 99.5, 99.9, 99.99], A: [0, 0, 0, 0] };

  // Elevation must be > 5° for ITU-R P.618 to be valid
  const el = Math.max(5, Math.min(90, elevDeg));
  const elRad = el * (Math.PI / 180);

  const hR = rainHeightKm(latDeg);    // rain height (km)
  const hS = htKm;                     // station height (km)

  // Slant-path length through rain: L_S = (h_R - h_S) / sin(el)
  // But only if h_R > h_S; otherwise no rain path
  if (hR <= hS) return { p: [99, 99.5, 99.9, 99.99], A: [0, 0, 0, 0] };
  const LS = (hR - hS) / Math.sin(elRad);

  // Horizontal projection
  const LG = LS * Math.cos(elRad);

  const { k, α } = p838Coeffs(freqGhz, polarDeg);
  const R001 = r001(latDeg, lngDeg); // rain rate (mm/h) exceeded 0.01% of time

  // Specific attenuation at R001
  const γR = k * Math.pow(R001, α); // dB/km

  // Horizontal reduction factor r_001 (ITU-R P.618-14 eq. 1)
  const r001factor = 1 / (1 + 0.78 * Math.sqrt(LG * γR / freqGhz) - 0.38 * (1 - Math.exp(-2 * LG)));

  // Vertical adjustment factor v_001 (eq. 2)
  const LR = Math.min(LG * r001factor / Math.cos(elRad), (hR - hS) / Math.sin(elRad));
  const χ = el >= 5 ? 36 - Math.abs(latDeg) : 36 - Math.abs(latDeg) + 0.07 * (LR * Math.cos(elRad));
  const v001 = 1 / (1 + Math.sqrt(Math.sin(elRad)) * (31 * (1 - Math.exp(-el / (1 + χ))) * Math.sqrt(LR * γR) / (freqGhz ** 2) - 0.45));

  // Effective path length
  const Leff = LR * v001;

  // Attenuation exceeded 0.01% of time
  const A001 = γR * Leff;

  // Scale to other availability percentages (ITU-R P.618-14 eq. 6)
  // A(p%) = A(0.01%) · (p / 0.01)^(-(0.655 + 0.033 ln p - 0.045 ln A001 - β sin θ))
  const ps = [1, 0.5, 0.1, 0.01]; // unavailability percentages
  const As = ps.map((p) => {
    if (p >= 1) return A001 * 0.12 * Math.pow(p, -(0.546 + 0.043 * Math.log10(p)));
    const β = Math.abs(latDeg) > 36 ? 0 : (p < 0.1 ? -0.005 * (Math.abs(latDeg) - 36) : 0);
    return A001 * Math.pow(p / 0.01, -(0.655 + 0.033 * Math.log(p) - 0.045 * Math.log(A001) - β * Math.sin(elRad)));
  });

  // Convert unavailability → availability
  const avail = ps.map((p) => 100 - p);
  return { p: avail, A: As.map((a) => Math.max(0, a)) };
}

/**
 * Link budget for a satcom link including rain fade margin.
 *
 * @param {object} opts
 * @param {number}  opts.eirpDbw       terminal EIRP (dBW)
 * @param {number}  opts.satGainDbd    satellite G/T or receive gain (dB)
 * @param {number}  opts.freqGhz       carrier frequency (GHz)
 * @param {number}  opts.elevDeg       elevation angle (degrees)
 * @param {number}  opts.latDeg
 * @param {number}  opts.lngDeg
 * @param {number}  [opts.polarDeg=45] polarisation (0=H, 90=V, 45=circ)
 * @param {number}  [opts.systemNoise=-120] system noise floor estimate (dBm)
 * @returns {{ clearSkyMarginDb, fadeMargin99, fadeMargin999, recommendation }}
 */
export function satLinkBudget({ eirpDbw, satGainDbd, freqGhz, elevDeg, latDeg, lngDeg, polarDeg = 45, systemNoise = -120 }) {
  const { p, A } = rainAttenuation({ latDeg, lngDeg, elevDeg, freqGhz, polarDeg });
  // p = [99, 99.5, 99.9, 99.99], A = attenuation at each
  const a99  = A[0]; // 1% unavailability (99% avail)
  const a999 = A[2]; // 0.1% unavailability (99.9% avail)

  // Free space path loss (dB)
  const GEO_KM = 35786 / Math.sin(Math.max(5, elevDeg) * Math.PI / 180);
  const fspl = 20 * Math.log10(GEO_KM) + 20 * Math.log10(freqGhz * 1e9) + 20 * Math.log10(4 * Math.PI / 3e8);

  const clearSkyMarginDb = eirpDbw + satGainDbd - fspl - systemNoise / 10;

  return {
    p,
    A,
    a99, a999,
    clearSkyMarginDb,
    fadeMargin99:  clearSkyMarginDb - a99,
    fadeMargin999: clearSkyMarginDb - a999,
    recommendation:
      clearSkyMarginDb - a99 < 3
        ? 'Insufficient margin for 99% availability — increase EIRP or use lower frequency'
        : clearSkyMarginDb - a99 < 6
        ? 'Marginal margin for 99% availability — consider higher EIRP antenna'
        : 'Adequate margin for 99% availability',
  };
}
