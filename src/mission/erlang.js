/**
 * Erlang-B traffic engineering (M13) — trunked-radio capacity planning.
 *
 * Pure + DOM-free so it is unit-testable and importable from a worker.
 *
 * DMR uses 2-slot TDMA: one repeater carrier carries two independent traffic
 * channels (timeslots). dmrCapacity() turns a per-team calling profile into an
 * offered load (Erlangs), a grade-of-service (blocking probability) for the
 * available timeslots, and a sizing recommendation against a target GoS.
 */

const DMR_SLOTS_PER_CARRIER = 2; // 2-slot TDMA

/**
 * Erlang-B blocking probability: the chance an arriving call is lost on a
 * loss system of N channels offered A Erlangs of traffic.
 *
 * Iterative form (numerically stable, no factorials):
 *   B(0, A) = 1
 *   B(n, A) = A·B(n-1, A) / (n + A·B(n-1, A))
 *
 * @param {number} N  number of channels (≥ 0, floored)
 * @param {number} A  offered load in Erlangs (≥ 0)
 * @returns {number}  blocking probability in [0, 1], or NaN on bad input
 */
export function erlangB(N, A) {
  if (!(N >= 0) || !(A >= 0)) return NaN;
  const n = Math.floor(N);
  let b = 1; // B(0, A): zero channels → everything blocks
  for (let k = 1; k <= n; k++) {
    b = (A * b) / (k + A * b);
  }
  return b;
}

/**
 * Smallest channel count whose Erlang-B blocking meets (≤) the target GoS for
 * an offered load A. Capped at `cap` channels.
 */
function channelsForGoS(A, targetGoS, cap = 64) {
  for (let n = 1; n <= cap; n++) {
    if (erlangB(n, A) <= targetGoS) return n;
  }
  return cap;
}

/**
 * DMR capacity assessment for a team / talkgroup.
 *
 * @param {object} opts
 * @param {number} [opts.timeslots]            available traffic channels (DMR slots)
 * @param {number} [opts.users]                radios sharing the talkgroup
 * @param {number} [opts.callsPerUserPerHour]  call attempts per user per hour
 * @param {number} [opts.avgCallDurationSec]   mean call holding time (seconds)
 * @param {number} [opts.targetGoS]            target grade of service (e.g. 0.02 = 2% blocking)
 * @returns {{ load:number, blocking:number, recommendation:string,
 *             neededSlots:number, neededCarriers:number, meetsTarget:boolean,
 *             targetGoS:number }}
 */
export function dmrCapacity({
  timeslots = 2,
  users = 10,
  callsPerUserPerHour = 4,
  avgCallDurationSec = 20,
  targetGoS = 0.02,
} = {}) {
  const slots = Math.max(1, Math.floor(timeslots));
  const target = Math.min(0.5, Math.max(0.0001, targetGoS));

  // Offered load A (Erlangs) = arrival rate × mean holding time.
  const load = Math.max(0, users) * Math.max(0, callsPerUserPerHour) * (Math.max(0, avgCallDurationSec) / 3600);
  const blocking = erlangB(slots, load);

  const neededSlots = channelsForGoS(load, target);
  const neededCarriers = Math.ceil(neededSlots / DMR_SLOTS_PER_CARRIER);
  const haveCarriers = Math.ceil(slots / DMR_SLOTS_PER_CARRIER);
  const meetsTarget = blocking <= target;

  const pct = (f) => `${(f * 100).toFixed(f < 0.1 ? 2 : 1)}%`;
  let recommendation;
  if (load === 0) {
    recommendation = 'No offered traffic — add users and a calling profile to size capacity.';
  } else if (meetsTarget) {
    const headroom = slots - neededSlots;
    recommendation =
      `Meets target: ${pct(blocking)} blocking on ${slots} slot${slots === 1 ? '' : 's'} ` +
      `(${haveCarriers} carrier${haveCarriers === 1 ? '' : 's'}) vs ${pct(target)} target` +
      (headroom > 0
        ? ` — ${headroom} slot${headroom === 1 ? '' : 's'} of headroom for growth.`
        : ' — no spare headroom.');
  } else {
    recommendation =
      `Over capacity: ${pct(blocking)} blocking on ${slots} slot${slots === 1 ? '' : 's'} ` +
      `exceeds the ${pct(target)} target. Need ${neededSlots} slots ` +
      `(${neededCarriers} DMR carrier${neededCarriers === 1 ? '' : 's'}) — add a talkgroup or split the team.`;
  }

  return { load, blocking, recommendation, neededSlots, neededCarriers, meetsTarget, targetGoS: target };
}
