/**
 * Mast / antenna height optimisation (M35) — pure computation, no DOM.
 *
 * "Raise the mast until line of sight is good": the minimum tx antenna height
 * that keeps the chosen fraction of the first Fresnel zone clear of
 * terrain + clutter on a link, with the k = 4/3 effective-earth bulge folded
 * in (same geometry as the coverage engine, one notch more physical than the
 * M14 chart, which omits the bulge over its short paths).
 *
 * The spec locked a bisection (clearance is monotonic in height); the
 * clearance margin at every sample is in fact LINEAR in the tx tip height —
 *   los(t) = txTip·(1 − t) + rxTip·t,  t = d₁/D —
 * so the minimum clearing height has a closed form: each sample i demands
 *   txTip ≥ (effᵢ + frac·r1ᵢ − rxTip·tᵢ) / (1 − tᵢ)
 * and the answer is the max over interior samples — one pass, exact, same
 * monotonicity guarantees the bisection relied on (asserted in tests).
 *
 * Samplers are injected (the E1 interfaces: dem { sample }, clutter
 * { heightM }), so this module unit-tests with synthetic profiles.
 * Advisory and planning-grade, not survey-grade.
 */

import { haversineM, earthBulgeM } from '../coverage/model.js';
import { fresnelRadius } from './path-profile.js';

/** Default search bounds (m above ground at the tx end). */
export const DEFAULT_MIN_M = 2;
export const DEFAULT_MAX_M = 30;

/**
 * Minimum height (m AGL) at the tx end that meets the clearance target on one
 * link. Pure; never throws on an unclearable path — that is the `limited`
 * result, with the blocking obstacle named instead of a false number.
 *
 * @param {object} o
 * @param {{lat,lng}} o.tx              mast position
 * @param {{lat,lng}} o.rx              link target
 * @param {number} [o.rxHeightM=1.5]    rx antenna above ground (m)
 * @param {number} o.freqMHz
 * @param {{sample(lng,lat):number}|null} [o.dem]      elevation sampler (E1)
 * @param {{heightM(lng,lat):number}|null} [o.clutter] clutter sampler (E1)
 * @param {number} [o.fraction=0.6]     first-Fresnel fraction to keep clear
 * @param {number} [o.minM]             mounting minimum (m)
 * @param {number} [o.maxM]             mast cap (m) — above ⇒ limited
 * @param {number} [o.steps=120]        profile samples
 * @returns {{
 *   heightM:number,            // recommended height (capped at maxM)
 *   requiredM:number,          // uncapped requirement (≥ minM)
 *   limited:boolean,           // true when even maxM does not clear
 *   minClearanceM:number,      // worst margin at heightM (≥ 0 unless limited)
 *   obstacle:{distM:number, terrainM:number, clutterM:number, idx:number}|null,
 *   profile:{distances:number[], ground:number[], effective:number[],
 *            clutterM:number[], clearances:number[], distanceM:number,
 *            txGroundM:number, rxTipM:number, txTipM:number},
 * }}
 */
export function minHeightForLink({
  tx,
  rx,
  rxHeightM = 1.5,
  freqMHz,
  dem = null,
  clutter = null,
  fraction = 0.6,
  minM = DEFAULT_MIN_M,
  maxM = DEFAULT_MAX_M,
  steps = 120,
} = {}) {
  if (!(freqMHz > 0)) throw new RangeError('minHeightForLink: freqMHz must be positive');
  if (!tx || !rx) throw new RangeError('minHeightForLink: tx and rx are required');
  const distanceM = haversineM(tx.lat, tx.lng, rx.lat, rx.lng);
  if (!(distanceM > 1)) throw new RangeError('minHeightForLink: tx and rx coincide');
  const n = Math.max(8, Math.round(steps));

  // Effective profile: ground + k=4/3 bulge + clutter (bare at the terminals —
  // antennas mount above their local clutter; same convention as P.1812).
  const distances = new Array(n);
  const ground = new Array(n);
  const clutterM = new Array(n);
  const effective = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const lat = tx.lat + (rx.lat - tx.lat) * t;
    const lng = tx.lng + (rx.lng - tx.lng) * t;
    const d1 = distanceM * t;
    distances[i] = d1;
    const g = dem ? dem.sample(lng, lat) : 0;
    ground[i] = Number.isFinite(g) ? g : 0;
    const c = i === 0 || i === n - 1 ? 0 : (clutter ? Math.max(0, clutter.heightM(lng, lat) || 0) : 0);
    clutterM[i] = c;
    effective[i] = ground[i] + earthBulgeM(d1, distanceM - d1) + c;
  }
  const txGroundM = ground[0];
  const rxTipM = ground[n - 1] + rxHeightM;

  // Closed-form minimum tip elevation (see header) over interior samples.
  let neededTipM = txGroundM + minM;
  let worstIdx = null;
  for (let i = 1; i < n - 1; i++) {
    const t = distances[i] / distanceM;
    const r1 = fresnelRadius(distances[i], distanceM - distances[i], freqMHz);
    const tip = (effective[i] + fraction * r1 - rxTipM * t) / (1 - t);
    if (tip > neededTipM) {
      neededTipM = tip;
      worstIdx = i;
    }
  }

  const requiredM = Math.max(minM, Math.ceil((neededTipM - txGroundM) * 10) / 10);
  const limited = requiredM > maxM;
  const heightM = limited ? maxM : requiredM;

  // Margins at the recommended height (drawn by the preview; also the proof
  // the closed form clears — asserted in tests).
  const txTipM = txGroundM + heightM;
  const clearances = new Array(n);
  let minClearanceM = Infinity;
  let minIdx = 0;
  for (let i = 0; i < n; i++) {
    const t = distances[i] / distanceM;
    const los = txTipM + (rxTipM - txTipM) * t;
    const r1 = fresnelRadius(distances[i], distanceM - distances[i], freqMHz);
    clearances[i] = los - fraction * r1 - effective[i];
    if (clearances[i] < minClearanceM) {
      minClearanceM = clearances[i];
      minIdx = i;
    }
  }

  const obIdx = limited ? minIdx : worstIdx;
  return {
    heightM,
    requiredM,
    limited,
    minClearanceM,
    obstacle:
      obIdx == null
        ? null
        : { distM: distances[obIdx], terrainM: ground[obIdx], clutterM: clutterM[obIdx], idx: obIdx },
    profile: { distances, ground, effective, clutterM, clearances, distanceM, txGroundM, rxTipM, txTipM },
  };
}

/**
 * Worst case over several links — the binding link is the one demanding the
 * tallest mast. Shared opts (freqMHz, dem, …) apply to every link; each link
 * is { rx, rxHeightM? } plus an optional label carried through.
 *
 * @returns {{ heightM, requiredM, limited, bindingIndex, results }}
 */
export function minHeightForLinks(links, shared) {
  if (!links?.length) throw new RangeError('minHeightForLinks: no links');
  const results = links.map((l) => minHeightForLink({ ...shared, ...l }));
  let bindingIndex = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].requiredM > results[bindingIndex].requiredM) bindingIndex = i;
  }
  const b = results[bindingIndex];
  return { heightM: b.heightM, requiredM: b.requiredM, limited: b.limited, bindingIndex, results };
}
