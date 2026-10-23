/**
 * M47 — Mission readiness score.
 *
 * Aggregates six intelligence dimensions into a single 0–100 score.
 * Uncomputed dimensions show as null and are not penalised — the score
 * is the average of the dimensions that have been computed.
 *
 * Dimensions:
 *   coverage       — RF coverage fraction over the AOI (0–100)
 *   pace           — PACE plan completeness (0–100)
 *   deconfliction  — Frequency deconfliction pass rate (0–100)
 *   linkQuality    — Average link-budget margin across topology edges (0–100)
 *   power          — Minimum node power endurance relative to mission hours (0–100)
 *   satcom         — Best GEO satellite elevation quality (0–100)
 *
 * Score thresholds:
 *   ≥75 = high (teal)   40–74 = mid (amber)   <40 = low (red)
 */

import { legFilled } from '../pace/pace.js';

export const READINESS_DIMS = [
  { key: 'coverage',      label: 'Coverage' },
  { key: 'pace',          label: 'PACE plan' },
  { key: 'deconfliction', label: 'Freq deconflict' },
  { key: 'linkQuality',   label: 'Link quality' },
  { key: 'power',         label: 'Power endurance' },
  { key: 'satcom',        label: 'Satcom' },
];

/**
 * Derive coverage dimension score.
 * @param {object|null} coverage — summarizeCoverage() output
 */
export function dimCoverage(coverage) {
  if (!coverage) return null;
  const f = coverage.coveredPct ?? (coverage.coveredFracAoi != null ? coverage.coveredFracAoi * 100 : null);
  return f != null ? Math.round(Math.min(Math.max(f, 0), 100)) : null;
}

/**
 * Derive PACE dimension score.
 * @param {object|null} pace — buildPace() output (has .legs array)
 */
export function dimPace(pace) {
  if (!pace?.legs?.length) return null;
  const filled = pace.legs.filter(legFilled).length;
  return Math.round((filled / pace.legs.length) * 100);
}

/**
 * Derive deconfliction dimension score.
 * @param {object[]|null} conflicts — deconflict(arsenal) output
 */
export function dimDeconfliction(conflicts) {
  if (conflicts == null) return null;
  if (conflicts.length === 0) return 100;
  const errors = conflicts.filter((c) => c.severity === 'error').length;
  const warns  = conflicts.filter((c) => c.severity === 'warn').length;
  return Math.max(0, 100 - errors * 25 - warns * 10);
}

/**
 * Derive link-quality dimension score.
 * @param {object} margins — { 'hq:rebro-static': { marginDb }, … }
 */
export function dimLinkQuality(margins) {
  if (!margins) return null;
  const vals = Object.values(margins)
    .map((m) => m?.marginDb)
    .filter((v) => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // 0 dB = 0%, 20 dB = 100%
  return Math.round(Math.min(Math.max((avg / 20) * 100, 0), 100));
}

/**
 * Derive power dimension score.
 * @param {object|null} powerSnap — from power section; expects { minEnduranceH, missionHours }
 */
export function dimPower(powerSnap) {
  if (!powerSnap?.minEnduranceH || !powerSnap?.missionHours) return null;
  return Math.round(Math.min((powerSnap.minEnduranceH / powerSnap.missionHours) * 100, 100));
}

/**
 * Derive satcom dimension score.
 * @param {object|null} satcomSnap — { bestStatus: 'ok'|'warn'|'marginal'|null }
 */
export function dimSatcom(satcomSnap) {
  if (!satcomSnap?.bestStatus) return null;
  return { ok: 100, warn: 60, marginal: 30, below: 10 }[satcomSnap.bestStatus] ?? null;
}

/**
 * Compute the aggregate readiness score.
 *
 * @param {object} dims — { coverage, pace, deconfliction, linkQuality, power, satcom }
 *   Each value is 0–100 or null (null = not yet computed, not penalised).
 * @returns {{ score: number|null, dims: object, tier: 'high'|'mid'|'low'|null }}
 */
/**
 * Fewest assessed dimensions before a score is shown. The score is the mean of
 * the dimensions that exist, so with one or two of them it says nothing about
 * the mission: an AOI alone (satcom look angle only) used to read 100.
 */
export const MIN_ASSESSED = 3;

/**
 * @returns {{ score:number|null, tier:'high'|'mid'|'low'|null, dims:object,
 *             assessed:number, total:number, pending:boolean }}
 *   `pending` is true while fewer than MIN_ASSESSED dimensions are assessed;
 *   score and tier are then null.
 */
export function computeReadiness(dims) {
  const scored = READINESS_DIMS
    .map((d) => dims[d.key])
    .filter((v) => v != null);
  const total = READINESS_DIMS.length;
  const assessed = scored.length;

  if (assessed < MIN_ASSESSED) return { score: null, dims, tier: null, assessed, total, pending: true };

  const score = Math.round(scored.reduce((a, b) => a + b, 0) / assessed);
  const tier  = score >= 75 ? 'high' : score >= 40 ? 'mid' : 'low';
  return { score, dims, tier, assessed, total, pending: false };
}
