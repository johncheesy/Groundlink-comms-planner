/**
 * Multi-band radio-mix recommendation (M5) — pure, rule-based, explainable.
 *
 * No AI, no opaque scoring: each band is included by a stated rule and carries a
 * one-line rationale. Input is the mission shape + terrain stats the app already
 * has; output is a ranked list that the "Radio mix" card renders and that M6
 * (PACE) consumes.
 *
 * ── Input (all fields optional; missing → 0 / unknown) ──────────────────────
 *   {
 *     aoiAreaKm2,          // AOI area
 *     routeLengthKm,       // total route length
 *     maxSiteDistanceKm,   // greatest site-to-site distance
 *     ruggednessM,         // stddev of the DEM sample grid (terrain roughness)
 *     urbanFrac,           // 0–1 fraction of demand in built-up WorldCover classes
 *     coverageFrac,        // 0–1 fraction covered by the last run
 *     pointCount,          // number of explicit demand points / fixed sites
 *   }
 *
 * ── Output (the M6 contract) ────────────────────────────────────────────────
 *   {
 *     bands: [
 *       {
 *         band: 'VHF'|'UHF'|'HF NVIS'|'LoRa'|'Satcom',
 *         rank: 1..n,                 // 1 = strongest fit
 *         pace: 'Primary'|'Alternate'|'Contingency'|'Emergency',
 *         why: string,                // one-line human rationale
 *         separateModule: boolean,    // true = no coverage raster in this milestone (HF)
 *       }, …
 *     ],
 *     inputs: { …echoed, normalised… },
 *   }
 *
 * PACE roles are a first pass for M6: the top terrestrial band is Primary, the
 * next Alternate, a beyond-LOS/HF leg Contingency, and Satcom always Emergency.
 */

const LONG_PATH_KM = 50; // beyond comfortable VHF/UHF line-of-sight
const URBAN_UHF_FRAC = 0.25; // built-up share that makes UHF worth leading with
const MANY_POINTS = 8; // fixed points that justify a LoRa telemetry overlay
const RUGGED_M = 120; // DEM stddev above which terrain materially blocks paths

const pct = (f) => `${Math.round((f || 0) * 100)}%`;
const km1 = (k) => `${(k || 0).toFixed(k >= 100 ? 0 : 1)} km`;

export function recommendMix(input = {}) {
  const inputs = {
    aoiAreaKm2: n(input.aoiAreaKm2),
    routeLengthKm: n(input.routeLengthKm),
    maxSiteDistanceKm: n(input.maxSiteDistanceKm),
    ruggednessM: n(input.ruggednessM),
    urbanFrac: clamp01(input.urbanFrac),
    coverageFrac: clamp01(input.coverageFrac),
    pointCount: Math.max(0, Math.round(n(input.pointCount))),
  };

  // Longest required path is the worst of the available span metrics.
  const aoiSpanKm = inputs.aoiAreaKm2 > 0 ? Math.sqrt(inputs.aoiAreaKm2) : 0;
  const reachKm = Math.max(inputs.maxSiteDistanceKm, inputs.routeLengthKm, aoiSpanKm);
  const rugged = inputs.ruggednessM >= RUGGED_M;

  const cands = [];

  // VHF — the ground-mobile workhorse. Always on the table.
  cands.push({
    band: 'VHF',
    score: 60 - inputs.urbanFrac * 30, // ceded to UHF in heavily built-up areas
    why: `VHF — ground-mobile workhorse: best range over vegetation and rolling terrain${rugged ? ', though this terrain is rugged (height/relays matter)' : ''}.`,
    separateModule: false,
  });

  // UHF — built-up / indoor penetration on short paths.
  if (inputs.urbanFrac >= URBAN_UHF_FRAC || inputs.maxSiteDistanceKm > 0 && inputs.maxSiteDistanceKm < 3) {
    cands.push({
      band: 'UHF',
      score: 40 + inputs.urbanFrac * 80 + (inputs.maxSiteDistanceKm > 0 && inputs.maxSiteDistanceKm < 3 ? 20 : 0),
      why: inputs.urbanFrac >= URBAN_UHF_FRAC
        ? `UHF — ${pct(inputs.urbanFrac)} of demand sits in built-up terrain; better building penetration on short paths.`
        : 'UHF — short site-to-site paths favour UHF; better in/around structures.',
      separateModule: false,
    });
  }

  // HF NVIS — beyond-LOS reach. Flagged as a separate module (no raster yet).
  if (reachKm > LONG_PATH_KM) {
    cands.push({
      band: 'HF NVIS',
      score: 70 + Math.min(reachKm, 200) / 10 + (rugged ? 8 : 0),
      why: `HF NVIS — longest required path ≈ ${km1(reachKm)} exceeds VHF/UHF line-of-sight; NVIS fills beyond-LOS${rugged ? ' over rugged terrain' : ''}. Separate module — no coverage raster in this milestone.`,
      separateModule: true,
    });
  }

  // LoRa — low-rate telemetry / tracking overlay when many fixed points exist.
  if (inputs.pointCount >= MANY_POINTS) {
    cands.push({
      band: 'LoRa',
      score: 45,
      why: `LoRa — ${inputs.pointCount} fixed points suit a low-rate telemetry / tracking overlay alongside voice.`,
      separateModule: false,
    });
  }

  // Satcom — always proposed as the Emergency leg; primary where nothing reaches.
  const thin = inputs.coverageFrac > 0 && inputs.coverageFrac < 0.5;
  cands.push({
    band: 'Satcom',
    score: thin ? 66 : 30,
    why: thin
      ? `Satcom — only ${pct(inputs.coverageFrac)} of demand reached terrestrially; satcom is the assured Emergency leg and the primary where terrain blocks all bands.`
      : 'Satcom — assured Emergency leg; primary where terrain blocks all terrestrial bands.',
    separateModule: false,
  });

  // Rank by score, then assign first-pass PACE roles.
  cands.sort((a, b) => b.score - a.score);
  const bands = cands.map((c, i) => ({
    band: c.band,
    rank: i + 1,
    pace: paceFor(c, i, cands),
    why: c.why,
    separateModule: c.separateModule,
  }));

  return { bands, inputs };
}

/** First-pass PACE assignment for M6. Satcom is always Emergency; HF is a
 *  Contingency beyond-LOS leg; the top two terrestrial bands are P then A. */
function paceFor(c, i, all) {
  if (c.band === 'Satcom') return 'Emergency';
  if (c.band === 'HF NVIS') return 'Contingency';
  const terrestrialBefore = all.slice(0, i).filter((x) => x.band !== 'Satcom' && x.band !== 'HF NVIS').length;
  if (terrestrialBefore === 0) return 'Primary';
  if (terrestrialBefore === 1) return 'Alternate';
  return 'Contingency';
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, n(v)));
