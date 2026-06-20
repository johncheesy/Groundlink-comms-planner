/**
 * M42 — Drone height optimizer.
 *
 * Samples relay coverage at a series of altitudes AGL and returns the
 * altitude that maximises coverage fraction within the AOI (or within the
 * 30 km default radius around the drone when no AOI is set).
 *
 * Uses the same coverage.computeAsync() path as M2.1 computeRelay(), but
 * with render:false for all candidates except the winner, which is rendered
 * to the map.
 *
 * @param {object} opts
 * @param {object}   opts.dronePos       — { lng, lat }
 * @param {number[]} opts.altitudes      — altitudes to test in metres AGL
 * @param {object}   opts.bounds         — { west, south, east, north }
 * @param {object}   opts.baseParams     — coverageParams() result
 * @param {Function} opts.computeAsync   — coverage.computeAsync()
 * @param {Function} [opts.onProgress]   — (doneCount, total) => void
 *
 * @returns {Promise<{
 *   best: { altM: number, coveredFrac: number },
 *   results: Array<{ altM: number, coveredFrac: number }>
 * }>}
 */

export const DEFAULT_ALTITUDES = [50, 100, 150, 200, 300, 500]; // m AGL

export async function optimizeDroneHeight({
  dronePos,
  altitudes = DEFAULT_ALTITUDES,
  bounds,
  baseParams,
  computeAsync,
  onProgress,
}) {
  if (!dronePos || !bounds || !computeAsync) throw new Error('optimizeDroneHeight: missing required options');

  const results = [];
  let done = 0;

  for (const altM of altitudes) {
    const r = await computeAsync(
      bounds,
      dronePos,
      { ...baseParams, txHeightM: altM },
      { render: false, marker: false },
    );
    const coveredFrac = r?.coveredFracAoi ?? r?.coveredFrac ?? 0;
    results.push({ altM, coveredFrac });
    done += 1;
    onProgress?.(done, altitudes.length);
  }

  // Find the altitude with the highest coverage fraction
  const best = results.reduce((a, b) => (b.coveredFrac > a.coveredFrac ? b : a), results[0]);

  // Render the best altitude to the map
  await computeAsync(
    bounds,
    dronePos,
    { ...baseParams, txHeightM: best.altM },
    { render: true, marker: false },
  );

  return { best, results };
}
