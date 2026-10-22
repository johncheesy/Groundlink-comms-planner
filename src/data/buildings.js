/**
 * Building heights for clutter — GHSL GHS-BUILT-H R2023A, average NET building
 * height (ANBH): per ~90 m cell (3 arc-seconds, EPSG:4326), the built-up
 * volume divided by the built-up surface, i.e. how tall the buildings in that
 * block are on average. Global, epoch 2018, CC BY 4.0 (Pesaresi & Politis,
 * European Commission JRC, 2023).
 *
 * Why not per-building footprints: the Overture extract the 3D view uses has
 * a height for about 1 % of buildings (checked 22 Oct 2026: Amsterdam 89 of
 * 8,027), and the coverage grid (100–300 m cells, ~1 km profile spacing)
 * cannot resolve single buildings anyway. P.1812 wants a representative
 * clutter height per location — a block average is that.
 *
 * Source: one global COG on the AWS Open Data bucket `jrc-ghsl` (CORS `*`,
 * byte ranges, overviews), read through the shared COG sampler.
 *
 * `buildBuildingHeights(bounds)` → `{ id, heightM(lng, lat) }`, or null when
 * the source is unreachable (clutter then keeps the WorldCover table value).
 */

export const GHSL_ANBH_URL =
  'https://jrc-ghsl.s3.amazonaws.com/ghs-built-h-anbh/r2023a/4326/3asec/2018/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_4326_3ss_V1_0.tif';

const TIMEOUT_MS = 20000;
/** Block averages above this are towers / artefacts; P.1812 clutter tops out well below. */
export const MAX_BUILDING_M = 60;

export async function buildBuildingHeights(bounds, { url = GHSL_ANBH_URL } = {}) {
  const { buildCogSampler } = await import('./cog.js');
  let timer;
  const sampler = await Promise.race([
    buildCogSampler(url, bounds, { maxDim: 1024, neutral: 0, interpolate: false }),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  if (!sampler) return null;
  return {
    id: 'ghsl',
    heightM(lng, lat) {
      const v = sampler.sample(lng, lat);
      return v > 0 ? Math.min(MAX_BUILDING_M, v) : 0;
    },
  };
}
