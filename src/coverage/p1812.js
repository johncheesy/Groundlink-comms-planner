/**
 * ITU-R P.1812-6 propagation engine — pure-JS port of the core path-loss
 * prediction for terrestrial point-to-area services, 30 MHz–6 GHz (E2).
 *
 * Implemented (Annex 1 section numbers):
 *   §4.1  Free-space loss (3-D slant distance) + multipath/focusing
 *         corrections Esp/Esβ — the "basic distance-correction terms".
 *   §4.2  Diffraction: Delta-Bullington — Bullington construction over the
 *         actual (terrain + clutter) profile, the smooth-path Bullington and
 *         the spherical-earth first-term residue (land/sea, H/V polarisation),
 *         with the Fi inverse-normal interpolation between the median (k50)
 *         and the β0 (kβ = 3) effective-earth radii for p < 50%.
 *   §4.3  Troposcatter.
 *   §4.5  Probabilistic combination of the LoS/diffraction/troposcatter terms
 *         by time percentage p.
 *   §4.7  Terminal clutter loss from representative clutter heights
 *         (knife-edge J(ν) height-gain form).
 *   §4.8  Location variability by pL (log-normal, σL default 5.5 dB).
 *
 * Deliberately omitted in v1 (documented in docs/E2-p1812-engine.md):
 *   §4.4  Ducting / layer reflection (Lba). The duct term mainly lifts small-p
 *         predictions on long over-water paths; without it this port predicts
 *         MORE loss there (conservative for planning). The §4.5 combination is
 *         evaluated in the Lba → ∞ limit, which collapses exactly to the
 *         diffraction path.
 *   Sea/coastal zone refinements (dct/dcr): β0's µ-factors assume the land
 *   fraction is (1 − seaFrac) of the path.
 *
 * Pure functions only — no DOM, no network — shared verbatim by the coverage
 * Web Worker, same discipline as ./model.js. All inputs are synthetic-profile
 * friendly: distances/heights only, no coordinates (latitude enters solely as
 * a scalar for the refractivity/β0 climate terms).
 */

import { knifeEdgeJ } from './model.js';

const log10 = (x) => Math.log(x) / Math.LN10;

/** Median effective-earth factor k50 = 157/(157 − ΔN)  (§3.5). */
export function medianEffectiveEarthKm(deltaN) {
  return (6371 * 157) / (157 - deltaN);
}

/**
 * Refractivity climate lookup — a small static stand-in for the ITU digital
 * maps (DN50.txt / N050.txt), keyed by latitude band. Planning-grade values:
 * the maps vary ΔN ≈ 30–70 and N0 ≈ 300–400; band medians are within the
 * spread that separates adjacent climates. No network, no data files.
 */
export function refractivityForLatitude(latDeg = 45) {
  const a = Math.abs(latDeg);
  if (a < 25) return { deltaN: 55, N0: 355 }; // tropical / equatorial
  if (a < 55) return { deltaN: 45, N0: 325 }; // temperate
  return { deltaN: 38, N0: 310 }; // sub-polar / polar
}

/**
 * Inverse complementary cumulative normal I(x) (Attachment 2 to Annex 1).
 * I(0.01) ≈ 2.33, I(0.5) = 0, I(x > 0.5) = −I(1 − x). Valid 1e-6 ≤ x.
 */
export function invCumNorm(x) {
  const xx = Math.min(Math.max(x, 1e-6), 1 - 1e-6);
  if (xx > 0.5) return -invCumNorm(1 - xx);
  const t = Math.sqrt(-2 * Math.log(xx));
  const C0 = 2.515516698, C1 = 0.802853, C2 = 0.010328;
  const D1 = 1.432788, D2 = 0.189269, D3 = 0.001308;
  const xi = ((C2 * t + C1) * t + C0) / (((D3 * t + D2) * t + D1) * t + 1);
  return t - xi;
}

/**
 * Time percentage β0 (%) below which anomalous refractivity gradients are
 * exceeded (§3.6), with the µ1/µ4 path-geometry factors evaluated for a path
 * whose land portion is dlm = (1 − ω)·d (no coastal-zone data in v1).
 */
export function beta0Percent(latDeg, dKm, omega = 0) {
  const phi = Math.abs(latDeg);
  const dtm = (1 - omega) * dKm; // longest continuous land section ≈ land part
  const dlm = dtm; // longest continuous inland section (no coastal zones)
  const tau = 1 - Math.exp(-0.000412 * dlm ** 2.41);
  const mu1 = Math.min(
    (10 ** (-dtm / (16 - 6.6 * tau)) + 10 ** (-5 * (0.496 + 0.354 * tau))) ** 0.2,
    1,
  );
  const mu4 = phi <= 70 ? mu1 ** (-0.935 + 0.0176 * phi) : mu1 ** 0.3;
  if (phi <= 70) return 10 ** (-0.015 * phi + 1.67) * mu1 * mu4;
  return 4.17 * mu1 * mu4;
}

/* ------------------------------------------------------------------ */
/* Internal geometry helpers. d[] in km, heights in m, f in GHz.      */
/* ------------------------------------------------------------------ */

/**
 * Smooth-earth surface (least-squares) + diffraction-model effective heights
 * (Attachment 1 to Annex 1). h = bare terrain (m amsl), g = terrain + clutter.
 * Returns { hst, hsr, hstd, hsrd } (m amsl).
 */
function smoothEarthHeights(d, h, g, hts, hrs) {
  const n = d.length;
  const dtot = d[n - 1];
  let v1 = 0;
  let v2 = 0;
  for (let i = 1; i < n; i++) {
    const dd = d[i] - d[i - 1];
    v1 += dd * (h[i] + h[i - 1]);
    v2 += dd * (h[i] * (2 * d[i] + d[i - 1]) + h[i - 1] * (d[i] + 2 * d[i - 1]));
  }
  const hst = (2 * v1 * dtot - v2) / dtot ** 2;
  const hsr = (v2 - v1 * dtot) / dtot ** 2;

  // Obstruction correction: shift the smooth surface down so it never cuts
  // through the dominant obstruction, apportioned by the horizon slopes.
  let hobs = -Infinity;
  let aobt = -Infinity;
  let aobr = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const HH = g[i] - (hts * (dtot - d[i]) + hrs * d[i]) / dtot;
    if (HH > hobs) hobs = HH;
    const at = HH / d[i];
    const ar = HH / (dtot - d[i]);
    if (at > aobt) aobt = at;
    if (ar > aobr) aobr = ar;
  }
  let hstp = hst;
  let hsrp = hsr;
  if (hobs > 0) {
    const gt = aobt / (aobt + aobr);
    const gr = aobr / (aobt + aobr);
    hstp = hst - hobs * gt;
    hsrp = hsr - hobs * gr;
  }
  return {
    hst,
    hsr,
    hstd: Math.min(hstp, h[0]),
    hsrd: Math.min(hsrp, h[n - 1]),
  };
}

/**
 * Bullington diffraction loss (§4.2.1) over profile heights `g` (m amsl) with
 * effective-earth radius ap (km). Terminal heights hts/hrs are m amsl.
 */
function bullingtonLoss(d, g, hts, hrs, ap, fGHz) {
  const n = d.length;
  const dtot = d[n - 1];
  const lambda = 0.2998 / fGHz; // m
  const Ce = 1 / ap; // km⁻¹

  // Slope from tx to each intermediate point (earth bulge folded in).
  let Stim = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const s = (g[i] + 500 * Ce * d[i] * (dtot - d[i]) - hts) / d[i];
    if (s > Stim) Stim = s;
  }
  const Str = (hrs - hts) / dtot;

  let Luc = 0;
  if (Stim < Str) {
    // LoS case: highest Fresnel-Kirchhoff parameter along the path.
    let vmax = -Infinity;
    for (let i = 1; i < n - 1; i++) {
      const clearance =
        g[i] + 500 * Ce * d[i] * (dtot - d[i]) - (hts * (dtot - d[i]) + hrs * d[i]) / dtot;
      const v = clearance * Math.sqrt((0.002 * dtot) / (lambda * d[i] * (dtot - d[i])));
      if (v > vmax) vmax = v;
    }
    if (vmax > -0.78) Luc = knifeEdgeJ(vmax);
  } else {
    // Trans-horizon: Bullington point from the two horizon slopes.
    let Srim = -Infinity;
    for (let i = 1; i < n - 1; i++) {
      const s = (g[i] + 500 * Ce * d[i] * (dtot - d[i]) - hrs) / (dtot - d[i]);
      if (s > Srim) Srim = s;
    }
    const db = (hrs - hts + Srim * dtot) / (Stim + Srim);
    const vb =
      (hts + Stim * db - (hts * (dtot - db) + hrs * db) / dtot) *
      Math.sqrt((0.002 * dtot) / (lambda * db * (dtot - db)));
    if (vb > -0.78) Luc = knifeEdgeJ(vb);
  }
  return Luc + (1 - Math.exp(-Luc / 6)) * (10 + 0.02 * dtot);
}

/**
 * First-term spherical-earth diffraction loss Ldft (§4.2.2.1) for one ground
 * type, normalized-residue form. adft km, heights m, f GHz.
 */
function firstTermSubpath(dKm, hte, hre, adft, fGHz, epsr, sigma, pol) {
  // Normalized surface-admittance factor K, H then V polarisation.
  let K =
    0.036 * (adft * fGHz) ** (-1 / 3) * ((epsr - 1) ** 2 + (18 * sigma / fGHz) ** 2) ** (-1 / 4);
  if (pol === 'v') K *= Math.sqrt(epsr ** 2 + (18 * sigma / fGHz) ** 2);
  const K2 = K * K;
  const K4 = K2 * K2;
  const beta = (1 + 1.6 * K2 + 0.67 * K4) / (1 + 4.5 * K2 + 1.53 * K4);

  const X = 21.88 * beta * (fGHz / adft ** 2) ** (1 / 3) * dKm;
  const Yfac = 0.9575 * beta * (fGHz ** 2 / adft) ** (1 / 3);
  const Fx = X >= 1.6 ? 11 + 10 * log10(X) - 17.6 * X : -20 * log10(X) - 5.6488 * X ** 1.425;
  const G = (Y) => {
    const B = beta * Y;
    const g = B > 2 ? 17.6 * Math.sqrt(B - 1.1) - 5 * log10(B - 1.1) - 8 : 20 * log10(B + 0.1 * B ** 3);
    return Math.max(g, 2 + 20 * log10(K));
  };
  return -Fx - G(Yfac * hte) - G(Yfac * hre);
}

/** Land/sea-mixed first-term loss (§4.2.2.1): ω = fraction of path over sea. */
function firstTermLoss(dKm, hte, hre, adft, fGHz, omega, pol) {
  const land = firstTermSubpath(dKm, hte, hre, adft, fGHz, 22, 0.003, pol);
  if (omega <= 0) return land;
  const sea = firstTermSubpath(dKm, hte, hre, adft, fGHz, 80, 5, pol);
  return omega * sea + (1 - omega) * land;
}

/** Spherical-earth diffraction loss Ldsph (§4.2.2). */
function sphericalEarthLoss(dKm, hte, hre, ap, fGHz, omega, pol) {
  if (hte <= 0 || hre <= 0) return firstTermLoss(dKm, Math.max(hte, 0.1), Math.max(hre, 0.1), ap, fGHz, omega, pol);
  const lambda = 0.2998 / fGHz;
  const dlos = Math.sqrt(2 * ap) * (Math.sqrt(0.001 * hte) + Math.sqrt(0.001 * hre));
  if (dKm >= dlos) return firstTermLoss(dKm, hte, hre, ap, fGHz, omega, pol);

  // Sub-horizon: clearance of the smooth-earth ray at the lowest point.
  const c = (hte - hre) / (hte + hre);
  const m = (250 * dKm * dKm) / (ap * (hte + hre));
  const b =
    2 * Math.sqrt((m + 1) / (3 * m)) *
    Math.cos(Math.PI / 3 + Math.acos(Math.min(1, Math.max(-1, ((3 * c) / 2) * Math.sqrt((3 * m) / (m + 1) ** 3)))) / 3);
  const dse1 = (dKm / 2) * (1 + b);
  const dse2 = dKm - dse1;
  const hse =
    ((hte - (500 * dse1 * dse1) / ap) * dse2 + (hre - (500 * dse2 * dse2) / ap) * dse1) / dKm;
  const hreq = 17.456 * Math.sqrt((dse1 * dse2 * lambda) / dKm);
  if (hse > hreq) return 0;

  // Modified effective radius giving marginal LoS at distance d.
  const aem = 500 * (dKm / (Math.sqrt(hte) + Math.sqrt(hre))) ** 2;
  const Ldft = firstTermLoss(dKm, hte, hre, aem, fGHz, omega, pol);
  if (Ldft < 0) return 0;
  return (1 - hse / hreq) * Ldft;
}

/** Delta-Bullington diffraction loss Ld (§4.2.3) for one effective radius. */
function deltaBullington(d, g, hZeros, hts, hrs, hstd, hsrd, ap, fGHz, omega, pol) {
  const dtot = d[d.length - 1];
  const Lbulla = bullingtonLoss(d, g, hts, hrs, ap, fGHz);
  const hts2 = hts - hstd;
  const hrs2 = hrs - hsrd;
  const Lbulls = bullingtonLoss(d, hZeros, hts2, hrs2, ap, fGHz);
  const Ldsph = sphericalEarthLoss(dtot, hts2, hrs2, ap, fGHz, omega, pol);
  return Lbulla + Math.max(Ldsph - Lbulls, 0);
}

/**
 * Terminal clutter loss Ah (§4.7) — knife-edge height-gain over the
 * representative clutter height R (m above ground) for a terminal whose
 * antenna sits hg metres above ground. 0 when the antenna clears the clutter.
 */
export function terminalClutterDb(fGHz, R, hg) {
  if (!(R > 0) || hg >= R) return 0;
  const hdif = R - hg;
  const thetaClut = (Math.atan(hdif / 27) * 180) / Math.PI; // degrees
  const Knu = 0.342 * Math.sqrt(fGHz);
  const v = Knu * Math.sqrt(hdif * thetaClut);
  return Math.max(0, knifeEdgeJ(v) - 6.03);
}

/* ------------------------------------------------------------------ */
/* Main prediction.                                                   */
/* ------------------------------------------------------------------ */

/**
 * ITU-R P.1812 basic transmission loss for one path.
 *
 * @param {object} args
 * @param {number} args.freqMHz       30–6000 MHz (throws outside)
 * @param {number} [args.p=50]        time percentage, 1–50
 * @param {number} [args.pL=50]       location percentage, 1–99
 * @param {number} [args.txHeightM=10]  tx antenna above ground (m)
 * @param {number} [args.rxHeightM=1.5] rx antenna above ground (m)
 * @param {Array}  args.profile       [{ distM, terrainM, clutterM? }] sampled
 *                                    tx→rx INCLUSIVE of both endpoints; bare-
 *                                    earth terrain + separate clutter heights
 *                                    (see docs/decisions/0005 — DSM runs
 *                                    terrain-only with clutterM = 0).
 * @param {'v'|'h'} [args.polarisation='v']
 * @param {number} [args.latDeg=45]   path-centre latitude (climate terms only)
 * @param {number} [args.N0]          sea-level refractivity (defaults by lat)
 * @param {number} [args.deltaN]      refractivity gradient (defaults by lat)
 * @param {number} [args.seaFrac=0]   fraction of the path over water (ω)
 * @param {number} [args.sigmaL=5.5]  location-variability std-dev (dB)
 * @returns {{ lossDb:number, fieldStrengthDbuV:number, components:object }}
 */
export function p1812Loss({
  freqMHz,
  p = 50,
  pL = 50,
  txHeightM = 10,
  rxHeightM = 1.5,
  profile,
  polarisation = 'v',
  latDeg = 45,
  N0,
  deltaN,
  seaFrac = 0,
  sigmaL = 5.5,
} = {}) {
  if (!(freqMHz >= 30 && freqMHz <= 6000)) {
    throw new RangeError(`P.1812 is valid 30–6000 MHz (got ${freqMHz} MHz)`);
  }
  if (!Array.isArray(profile) || profile.length < 2) {
    throw new RangeError('P.1812 needs a tx→rx profile with at least 2 points');
  }
  const fGHz = freqMHz / 1000;
  const pol = polarisation === 'h' ? 'h' : 'v';
  const pp = Math.min(Math.max(p, 1), 50);
  const ppL = Math.min(Math.max(pL, 1), 99);
  const omega = Math.min(Math.max(seaFrac, 0), 1);
  const climate = refractivityForLatitude(latDeg);
  const n0 = N0 ?? climate.N0;
  const dN = deltaN ?? climate.deltaN;

  // Profile in km / m; g = terrain + clutter (terminals stay bare per §3.1).
  const n = profile.length;
  const d = new Array(n);
  const h = new Array(n);
  const g = new Array(n);
  const zeros = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    d[i] = profile[i].distM / 1000;
    h[i] = profile[i].terrainM;
    g[i] = h[i] + (i === 0 || i === n - 1 ? 0 : profile[i].clutterM || 0);
  }
  const dtot = d[n - 1];
  if (!(dtot > 0)) throw new RangeError('P.1812 profile must span a positive distance');

  const hts = h[0] + txHeightM;
  const hrs = h[n - 1] + rxHeightM;
  const ae = medianEffectiveEarthKm(dN);
  const ab = 6371 * 3; // kβ = 3 effective radius for the β0 tail
  const beta0 = beta0Percent(latDeg, dtot, omega);

  // §4.1 — free-space loss over the 3-D slant distance + multipath/focusing.
  const dfs = Math.sqrt(dtot ** 2 + ((hts - hrs) / 1000) ** 2);
  const Lbfs = 92.4 + 20 * log10(fGHz) + 20 * log10(dfs);

  // Horizon geometry (for Esp's dlt+dlr and troposcatter's angular distance).
  let thetaTmax = -Infinity;
  let thetaRmax = -Infinity;
  let dlt = dtot / 2;
  let dlr = dtot / 2;
  for (let i = 1; i < n - 1; i++) {
    const tT = 1000 * Math.atan((g[i] - hts) / (1000 * d[i]) - d[i] / (2 * ae));
    if (tT > thetaTmax) { thetaTmax = tT; dlt = d[i]; }
    const tR = 1000 * Math.atan((g[i] - hrs) / (1000 * (dtot - d[i])) - (dtot - d[i]) / (2 * ae));
    if (tR > thetaRmax) { thetaRmax = tR; dlr = dtot - d[i]; }
  }
  const thetaTd = 1000 * Math.atan((hrs - hts) / (1000 * dtot) - dtot / (2 * ae));
  const thetaRd = 1000 * Math.atan((hts - hrs) / (1000 * dtot) - dtot / (2 * ae));
  const losPath = thetaTmax < thetaTd;
  const thetaT = losPath ? thetaTd : thetaTmax;
  const thetaR = n > 2 && thetaRmax >= thetaRd ? thetaRmax : thetaRd;
  if (losPath) { dlt = dtot / 2; dlr = dtot / 2; }
  const theta = (1000 * dtot) / ae + thetaT + thetaR; // mrad

  const Efac = 2.6 * (1 - Math.exp(-0.1 * (dlt + dlr)));
  const Esp = Efac * log10(pp / 50);
  const Esb = Efac * log10(beta0 / 50);
  const Lb0p = Lbfs + Esp;
  const Lb0b = Lbfs + Esb;

  // §4.2 — Delta-Bullington at the median and β0 effective radii.
  const { hstd, hsrd } = smoothEarthHeights(d, h, g, hts, hrs);
  const Ld50 = deltaBullington(d, g, zeros, hts, hrs, hstd, hsrd, ae, fGHz, omega, pol);
  let Fi = 0;
  let Ldp = Ld50;
  if (pp < 50) {
    const Ldb = deltaBullington(d, g, zeros, hts, hrs, hstd, hsrd, ab, fGHz, omega, pol);
    Fi = pp > beta0 ? invCumNorm(pp / 100) / invCumNorm(beta0 / 100) : 1;
    Ldp = Ld50 + Fi * (Ldb - Ld50);
  }

  // §4.5 — combine LoS + diffraction (ducting omitted: the Lba → ∞ limit
  // makes Lbda = Lbd exactly), then blend with troposcatter.
  const Lbd50 = Lbfs + Ld50;
  const Lbd = Lb0p + Ldp;
  let Lminb0p;
  if (pp < beta0) {
    Lminb0p = Lb0p + (1 - omega) * Ldp;
  } else {
    const FiC = invCumNorm(pp / 100) / invCumNorm(beta0 / 100);
    Lminb0p = Lbd50 + (Lb0b + (1 - omega) * Ldp - Lbd50) * FiC;
  }
  // Interpolation factor between the diffraction and notional-LoS regimes
  // (ξ = 0.8, Θ = 0.3 mrad — the P.452-family constants).
  const Fj = 1 - 0.5 * (1 + Math.tanh((3 * 0.8 * (theta - 0.3)) / 0.3));
  const Lbam = Lbd + (Lminb0p - Lbd) * Fj;

  // §4.3 — troposcatter, then soft-minimum blend (eq. blending exponent 0.2).
  const Lf = 25 * log10(fGHz) - 2.5 * log10(fGHz / 2) ** 2;
  const Lbs =
    190.1 + Lf + 20 * log10(dtot) + 0.573 * theta - 0.15 * n0 -
    10.125 * Math.max(0, log10(50 / pp)) ** 0.7;
  const Lbc = -5 * log10(10 ** (-0.2 * Lbs) + 10 ** (-0.2 * Lbam));

  // §4.7 — terminal clutter from the representative heights at each end.
  const clutterTxDb = terminalClutterDb(fGHz, profile[0].clutterM || 0, txHeightM);
  const clutterRxDb = terminalClutterDb(fGHz, profile[n - 1].clutterM || 0, rxHeightM);

  // Final 50%-locations loss: never better than the notional LoS loss.
  const Lb50loc = Math.max(Lb0p, Lbc + clutterTxDb + clutterRxDb);

  // §4.8 — location variability (log-normal about the median).
  const locationDb = ppL === 50 ? 0 : -sigmaL * invCumNorm(ppL / 100);
  const lossDb = Lb50loc + locationDb;

  return {
    lossDb,
    // Field strength (dBµV/m) for 1 kW e.r.p. — the recommendation's output.
    fieldStrengthDbuV: 199.36 + 20 * log10(fGHz) - lossDb,
    components: {
      fsplDb: Lbfs,
      multipathDb: Esp,
      diffractionDb: Ldp,
      diffraction50Db: Ld50,
      troposcatterDb: Lbs,
      clutterTxDb,
      clutterRxDb,
      locationDb,
      beta0,
      thetaMrad: theta,
    },
  };
}

/**
 * Convenience mirroring model.js receivedDbm() so the coverage worker swaps
 * engines cleanly: received (dBm) = EIRP − L(P.1812) + rx gain.
 *
 * @param {{eirpDbm:number, freqMHz:number, rxGainDbi?:number}} radio
 * @param {Array} profile  tx→rx profile (see p1812Loss)
 * @param {object} [opts]  p, pL, txHeightM, rxHeightM, latDeg, … (see p1812Loss)
 */
export function receivedDbmP1812(radio, profile, opts = {}) {
  const { lossDb } = p1812Loss({ freqMHz: radio.freqMHz, profile, ...opts });
  return radio.eirpDbm - lossDb + (radio.rxGainDbi ?? 0);
}
