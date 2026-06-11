/**
 * M20 §1 — pure selector for the plan-stepper chip. main.js gathers the app
 * state ({ aoiSet, rfObjectCount, arsenalCount, hasResult, stale }) and the
 * stepper renders from the derived { step, done, stale }.
 *
 *   mission done = AOI set OR ≥1 RF object placed
 *   radios  done = arsenal non-empty
 *   plan    done = a current (non-stale) coverage/PACE result exists
 *
 * step = the first undone step (1 Mission · 2 Radios · 3 Plan), capped at 3.
 */

export function planState(state = {}) {
  const { aoiSet = false, rfObjectCount = 0, arsenalCount = 0, hasResult = false, stale = false } = state;
  const done = {
    mission: Boolean(aoiSet) || rfObjectCount > 0,
    radios: arsenalCount > 0,
    plan: Boolean(hasResult) && !stale,
  };
  const step = !done.mission ? 1 : !done.radios ? 2 : 3;
  return { step, done, stale: Boolean(stale) };
}
