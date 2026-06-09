// HF ionosphere planning (M12) — pure computation, no DOM.
//
// Given a date/time, a location and a path length, estimate whether HF will
// propagate: foF2 (critical frequency), MUF, LUF, OWF, and which amateur/HF
// bands are viable, marginal or closed. NVIS vs skywave is inferred from the
// path length and the band geometry.
//
// This is a deliberately compact climatological model — planning-grade, not a
// replacement for VOACAP/IRI. It blends a day and a night foF2 by the solar
// zenith angle, scales to MUF by an obliquity (M-)factor that grows with path
// length, and sets the LUF from daytime D-layer absorption.

// ---- Solar zenith angle -------------------------------------------------
// Compact NOAA-style solar position. Returns the zenith angle in degrees
// (0 = sun overhead, 90 = horizon, >90 = below horizon).
function solarZenithAngle(date, latDeg, lngDeg) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const JD = date.getTime() / 86400000 + 2440587.5;
  const n = JD - 2451545.0;
  const L = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360) + 360) % 360;
  const lambda = L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad);
  const eps = 23.439 - 4e-7 * n;
  const sinLambda = Math.sin(lambda * rad);
  const decl = Math.asin(Math.max(-1, Math.min(1, Math.sin(eps * rad) * sinLambda))) * deg;
  let RA = Math.atan2(Math.cos(eps * rad) * sinLambda, Math.cos(lambda * rad)) * deg;
  if (RA < 0) RA += 360;
  const GMST =
    (((6.697375 +
      0.0657098242 * n +
      (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600)) %
      24) +
      24) %
    24;
  const HA = ((((GMST + lngDeg / 15) - RA / 15 + 24) % 24) * 15) * rad;
  const lat = latDeg * rad;
  const dec = decl * rad;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(HA);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * deg;
  return 90 - alt;
}

// HF bands assessed for viability. Frequency windows are nominal allocations.
export const HF_BANDS = [
  { band: '3 MHz (90m)', fLow: 2.3, fHigh: 3.5 },
  { band: '5 MHz (60m)', fLow: 4.75, fHigh: 5.45 },
  { band: '7 MHz (40m)', fLow: 6.8, fHigh: 7.3 },
  { band: '10 MHz (30m)', fLow: 9.5, fHigh: 10.1 },
  { band: '14 MHz (20m)', fLow: 13.5, fHigh: 14.5 },
  { band: '18 MHz (17m)', fLow: 17.9, fHigh: 18.2 },
  { band: '21 MHz (15m)', fLow: 20.5, fHigh: 21.5 },
  { band: '28 MHz (10m)', fLow: 27.5, fHigh: 29.7 },
];

const SSN_BY_CYCLE = { low: 30, medium: 100, high: 180 };

/**
 * Estimate HF ionospheric conditions.
 *
 * @param {object}  opts
 * @param {number}  opts.lat        latitude (deg, +N)
 * @param {number}  opts.lng        longitude (deg, +E)
 * @param {Date}    opts.dt         date/time (UTC fields are read)
 * @param {number} [opts.pathKm=0]  great-circle path length (0 = local/NVIS)
 * @param {'low'|'medium'|'high'} [opts.solarCycle='medium'] solar activity
 * @returns {{
 *   foF2:number, muf:number, luf:number, ouf:number,
 *   nvisViable:boolean, nightAbsorb:boolean,
 *   mode:'nvis'|'skywave'|'both'|'none',
 *   bands:Array<{band:string,fLow:number,fHigh:number,status:'viable'|'marginal'|'no',reason:string}>,
 *   solarZenith:number, season:'summer'|'winter'
 * }}
 */
export function computeHfConditions({ lat, lng, dt, pathKm = 0, solarCycle = 'medium' }) {
  const zenith = solarZenithAngle(dt, lat, lng);
  const effectivePath = Math.max(0, pathKm);

  // ---- foF2 (critical frequency, MHz) ----
  const ssn = SSN_BY_CYCLE[solarCycle] ?? SSN_BY_CYCLE.medium;
  const fluxProxy = 63 + 0.728 * ssn; // ~10.7 cm flux proxy from SSN
  const dayFoF2 = 4.5 + 0.02 * fluxProxy;
  const nightFoF2 = 2.5 + 0.008 * fluxProxy;
  const latFactor = 1 - 0.004 * Math.abs(lat);
  const month = dt.getUTCMonth();
  const isNorthernSummer = lat >= 0 ? month >= 4 && month <= 8 : month < 2 || month > 9;
  const seasonFactor = isNorthernSummer ? 1.1 : 0.88;
  const dayFrac = Math.max(0, Math.cos((zenith * Math.PI) / 180));
  const foF2 = (dayFoF2 * dayFrac + nightFoF2 * (1 - dayFrac)) * latFactor * seasonFactor;

  // ---- MUF (maximum usable frequency, MHz) ----
  // Obliquity factor grows with path length: ~1.1 for NVIS, up to ~3+ for DX.
  let mFactor;
  if (effectivePath <= 300) mFactor = 1.1;
  else if (effectivePath <= 1500) mFactor = 1.1 + ((effectivePath - 300) / 1200) * 1.9;
  else mFactor = 3.0 + effectivePath / 5000;
  const muf = Math.min(30, foF2 * mFactor);

  // ---- LUF (lowest usable frequency, MHz) ----
  // Driven by daytime D-layer absorption; at night it collapses to ~1 MHz.
  const isDaytime = zenith < 90;
  const absorptionFactor = isDaytime ? Math.max(0, Math.cos((zenith * Math.PI) / 180)) : 0;
  const luf = isDaytime
    ? 1.5 + 0.5 * absorptionFactor * (fluxProxy / 80) + effectivePath / 2000
    : 1.0;

  // ---- OWF / OUF (optimum working frequency) ----
  const ouf = 0.85 * muf;

  // ---- NVIS ----
  const nvisViable = foF2 > luf && effectivePath <= 500;
  const nightAbsorb = !isDaytime; // low absorption at night → low bands open

  // ---- Per-band assessment ----
  const bands = HF_BANDS.map((b) => {
    let status;
    let reason;
    if (b.fHigh < luf || b.fLow >= muf) {
      status = 'no';
      reason = b.fLow >= muf ? `above MUF (${muf.toFixed(1)})` : `below LUF (${luf.toFixed(1)})`;
    } else if (b.fLow > luf && b.fHigh <= muf) {
      status = 'viable';
      reason = `within LUF–MUF window`;
    } else {
      status = 'marginal';
      reason =
        b.fHigh > muf
          ? `upper edge above MUF (${muf.toFixed(1)})`
          : `lower edge near LUF (${luf.toFixed(1)})`;
    }
    return { ...b, status, reason };
  });

  // ---- Mode ----
  const anyOpen = bands.some((b) => b.status !== 'no');
  const skywaveViable = anyOpen && effectivePath > 300 && muf > luf;
  let mode;
  if (nvisViable && skywaveViable) mode = 'both';
  else if (nvisViable) mode = 'nvis';
  else if (skywaveViable) mode = 'skywave';
  else mode = 'none';

  return {
    foF2,
    muf,
    luf,
    ouf,
    nvisViable,
    nightAbsorb,
    mode,
    bands,
    solarZenith: zenith,
    season: isNorthernSummer ? 'summer' : 'winter',
  };
}
