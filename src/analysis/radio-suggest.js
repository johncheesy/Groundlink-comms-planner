/**
 * M46 — Smart radio-to-node heuristic.
 *
 * Scores every radio in the arsenal against each operational node role and
 * returns a ranked list of recommendations (top 3 per role). The suggestions
 * are advisory — the user applies them via an explicit "Apply" button that
 * uses the same undo/stale flow as M35 (mast wizard).
 *
 * Scoring dimensions:
 *   40% Range match   — can the radio cover the required operational reach?
 *   30% Band suitability — does the role preference list include this radio's role?
 *   20% Power class   — does TX power match the role's max power class?
 *   10% Digital mode  — structured digital mode preferred for HQ/rebro/mobile-CP roles
 *
 * All scores 0–100.
 */

import { maxRangeM } from '../coverage/model.js';

// ── Constants ──────────────────────────────────────────────────────────────

// Prefer-list position → score fraction (0=best, others diminish)
const PREFER_SCORES = [1.0, 0.6, 0.35, 0.15, 0.05];

// Roles that benefit from structured digital modes (DMR/P25/dPMR)
const DIGITAL_PREFERRED_ROLES = new Set(['hq', 'rebro-static', 'rebro-mobile', 'mobile-cp']);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute the max range (km) the radio can cover at its default frequency. */
function radioMaxRangeKm(radio) {
  const freqMHz = radio.defaultFreqMHz ?? (radio.freqRangeMHz?.[0] ?? 150);
  const txW = radio.txMaxW ?? radio.powerW ?? 5;
  const eirpDbm = 10 * Math.log10(txW * 1000);
  const rxSens = radio.rxSensDbm ?? -110;
  const m = maxRangeM({ eirpDbm, freqMHz, rxGainDbi: 0, floorDbm: rxSens });
  return m / 1000;
}

/** Prefer-list match score for a radio vs role's prefer array. */
function preferScore(radio, role) {
  if (!role.prefer || !role.prefer.length) return 0.5;
  const radioRole = radio.role ?? 'manpack';
  const idx = role.prefer.indexOf(radioRole);
  return idx >= 0 ? PREFER_SCORES[Math.min(idx, PREFER_SCORES.length - 1)] : 0.05;
}

/** Range match score (0–1). Covers full reach → 1.0; falls off below. */
function rangeScore(radio, reachKm) {
  if (!reachKm || reachKm <= 0) return 0.5; // unknown reach — neutral
  const maxKm = radioMaxRangeKm(radio);
  return Math.min(maxKm / Math.max(reachKm, 1), 1.0);
}

/** Power class score (0–1). Radio TX ≥ role max → 1.0; falls off below. */
function powerScore(radio, role) {
  const roleTxW = role.txMaxW ?? 5;
  const radioTxW = radio.txMaxW ?? radio.powerW ?? 1;
  return Math.min(radioTxW / Math.max(roleTxW, 1), 1.0);
}

/** Digital mode score (0–1). DMR/P25/dPMR preferred for command roles. */
function digitalScore(radio, role) {
  const mode = (radio.digitalMode ?? radio.modes ?? '').toString().toLowerCase();
  const hasDigital = mode.includes('dmr') || mode.includes('p25') || mode.includes('dpmr');
  if (DIGITAL_PREFERRED_ROLES.has(role.key)) {
    return hasDigital ? 1.0 : 0.3;
  }
  return 0.6; // operator/handheld — digital is nice but not critical
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Score a single radio against a single role.
 *
 * @param {object} radio   — radio entry from the arsenal
 * @param {object} role    — role definition from assignRoles()
 * @param {object} context — { reachKm }
 * @returns {number} 0–100
 */
export function scoreRadioForRole(radio, role, context = {}) {
  const r = rangeScore(radio, context.reachKm ?? 0);
  const p = preferScore(radio, role);
  const w = powerScore(radio, role);
  const d = digitalScore(radio, role);
  return Math.round((r * 0.40 + p * 0.30 + w * 0.20 + d * 0.10) * 100);
}

/**
 * Build ranked suggestions for all roles.
 *
 * @param {object[]} arsenal — from radios.getArsenal()
 * @param {object[]} roles   — from assignRoles(arsenal, ctx)
 * @param {object}   context — { reachKm }
 * @returns {Array<{ role, suggestions: Array<{ radio, score }> }>}
 */
export function suggestRadios(arsenal, roles, context = {}) {
  return roles.map((role) => {
    const scored = arsenal.map((radio) => ({
      radio,
      score: scoreRadioForRole(radio, role, context),
    }));
    scored.sort((a, b) => b.score - a.score);
    return {
      role,
      suggestions: scored.slice(0, 3).filter((s) => s.score > 0),
    };
  });
}
