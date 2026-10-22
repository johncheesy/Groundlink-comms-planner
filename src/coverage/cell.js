/**
 * Received level at one location — the single per-cell model step shared by
 * the coverage worker (every raster cell) and field validation (every
 * measured point), so a validation always scores the math the map paints.
 *
 * Engines: ITU-R P.1812 (when params.engine === 'p1812' and a DEM exists;
 * clutter heights ride in the profile) or FSPL + Deygout (clutter as a dB
 * term at the receiver). Directional tx antennas subtract their pattern loss.
 */

import { haversineM, receivedDbm, deygoutLossDb } from './model.js';
import { receivedDbmP1812 } from './p1812.js';
import { patternLossDb, bearingDeg, isOmni } from './antenna.js';
import { buildProfile, buildProfileP1812 } from '../workers/profile.js';

/** Below P.1812's validity floor (0.25 km) plain free space is the honest answer. */
export const P1812_MIN_DIST_M = 250;

/** The directional antenna a transmitter uses (site override, else the run's), or null for omni. */
export function txAntenna(t, params) {
  const a = t.antenna ?? params.antenna;
  return a && !isOmni(a) ? a : null;
}

/**
 * dBm from one transmitter at (lng, lat).
 *
 * @param {object} c
 * @param {object} c.t        transmitter { lat, lng, txHeightM?, antenna?, eirpDbm? }
 * @param {number} c.txElev   tx antenna height amsl (m) — DEM + mast
 * @param {number} c.lng
 * @param {number} c.lat
 * @param {number} c.rxElev   rx antenna height amsl (m)
 * @param {number} c.clutterDb  receiver clutter loss for the FSPL+Deygout path
 * @param {object} c.params   coverage params (eirpDbm, freqMHz, p, pL, rxHeightM, useClutter, …)
 * @param {object|null} c.dem
 * @param {object|null} c.clutter  clutter sampler ({ heightM, dbAt })
 * @param {boolean} c.useP1812
 * @param {object|null} c.antenna  from txAntenna()
 */
export function txDbmAt({ t, txElev, lng, lat, rxElev, clutterDb, params, dem, clutter, useP1812, antenna }) {
  const dist = haversineM(t.lat, t.lng, lat, lng);
  let dbm;
  if (useP1812 && dist > P1812_MIN_DIST_M) {
    // Clutter rides in the profile heights only (P.1812-8) — never also as
    // the per-class dB term, so nothing counts twice.
    const prof = buildProfileP1812(t, { lng, lat }, dist, dem, params.useClutter ? clutter : null);
    dbm = receivedDbmP1812(params, prof, {
      p: params.p ?? 50,
      pL: params.pL ?? 50,
      txHeightM: t.txHeightM ?? params.txHeightM ?? 10,
      rxHeightM: params.rxHeightM ?? 1.5,
      latDeg: (t.lat + lat) / 2,
    });
  } else {
    let diffraction = 0;
    if (dem && dist > 50) {
      diffraction = deygoutLossDb(buildProfile(t, { lng, lat }, dist, dem), txElev, rxElev, params.freqMHz, dist);
    }
    dbm = receivedDbm(params, dist, diffraction, useP1812 ? 0 : clutterDb);
  }
  // A site with its own power (M50): both engines are linear in EIRP.
  if (t.eirpDbm != null) dbm += t.eirpDbm - params.eirpDbm;
  if (antenna) dbm -= patternLossDb(antenna, bearingDeg(t.lat, t.lng, lat, lng));
  return dbm;
}

/** Strongest transmitter's level at one point (field validation, spot checks). */
export function bestDbmAt(lng, lat, { txs, params, dem = null, clutter = null }) {
  const useP1812 = params.engine === 'p1812' && !!dem;
  const rxElev = (dem ? dem.sample(lng, lat) : 0) + (params.rxHeightM ?? 1.5);
  const clutterDb = clutter && params.useClutter ? clutter.dbAt(lng, lat) : params.clutterDb || 0;
  let best = -Infinity;
  for (const t of txs) {
    const txElev = (dem ? dem.sample(t.lng, t.lat) : 0) + (t.txHeightM ?? params.txHeightM ?? 10);
    const dbm = txDbmAt({ t, txElev, lng, lat, rxElev, clutterDb, params, dem, clutter, useP1812, antenna: txAntenna(t, params) });
    if (dbm > best) best = dbm;
  }
  return best;
}
