/**
 * Hilbert tileId codec for PMTiles v3 — vendored from the `pmtiles` package
 * (BSD-3-Clause, © Protomaps LLC; https://github.com/protomaps/PMTiles).
 *
 * Why vendored: the offline-package writer (offline.js) is sync and needs only
 * this ~30-line pure function, but `pmtiles` ships as a single module without
 * `sideEffects: false`, so importing anything from it statically drags fflate
 * (~35 kB minified) into the main app chunk. The heavyweight PMTiles reader /
 * Protocol stay dynamically imported. Correctness is pinned by the round-trip
 * test in offline.test.js, which reads our archives back with the real
 * `pmtiles` reader.
 */

function rotate(n, x, y, rx, ry) {
  if (ry === 0) {
    if (rx !== 0) return [n - 1 - y, n - 1 - x];
    return [y, x];
  }
  return [x, y];
}

/** (z, x, y) → PMTiles v3 Hilbert tile id. Matches pmtiles' zxyToTileId. */
export function zxyToTileId(z, x, y) {
  if (z > 26) throw new Error('Tile zoom level exceeds max safe number limit (26)');
  if (x >= 1 << z || y >= 1 << z) throw new Error('tile x/y outside zoom level bounds');
  let acc = ((1 << z) * (1 << z) - 1) / 3;
  let n = z - 1;
  let pos = [x, y];
  for (let a = 1 << n; a > 0; a >>= 1) {
    const rx = pos[0] & a;
    const ry = pos[1] & a;
    acc += ((3 * rx) ^ ry) * (1 << n);
    pos = rotate(a, pos[0], pos[1], rx, ry);
    n--;
  }
  return acc;
}
