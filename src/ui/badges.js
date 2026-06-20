/**
 * M20 §2 — pure badge model. From app state produce per-module and per-group
 * badges for the left-menu group headers, the section headers and the
 * collapsed strip icons.
 *
 * Badge shape: { type: 'count' | 'check' | 'dot', value? }.
 *   objects  → count (when any placed)
 *   aoi      → check when set
 *   radios   → count, including an explicit "0" (the empty arsenal is the
 *              thing the user must notice)
 *   coverage → amber stale dot while the plan is dirty
 * Group aggregate: counts sum; a dot beats everything; a check shows only
 * when the group has no count.
 */
import { NAV_GROUPS } from './groups.js';

// ---- E3b: model accuracy badge -------------------------------------------

const MODEL_ACCURACY = {
  p1812:   { label: 'P.1812',       margin: '±8 dB',  tooltip: 'ITU-R P.1812 Delta-Bullington — validated on median propagation' },
  deygout: { label: 'FSPL+Deygout', margin: '±12 dB', tooltip: 'Free-space path loss + Deygout diffraction — tends to overestimate loss at multiple edges' },
  cloudrf: { label: 'ITM/CloudRF',  margin: '±6 dB',  tooltip: 'Longley-Rice ITM via CloudRF API — more accurate but requires API key' },
  flat:    { label: 'FSPL flat',    margin: '±15 dB',  tooltip: 'Free-space path loss only — no terrain, no diffraction' },
};

/**
 * E3b — Render an inline model-accuracy span for the result card.
 * @param {string} modelKey  — 'p1812' | 'deygout' | 'cloudrf' | 'flat'
 * @param {string|null} percentileLabel — e.g. '50% time' or null
 */
export function modelBadge(modelKey, percentileLabel) {
  const info = MODEL_ACCURACY[modelKey] ?? { label: modelKey, margin: '±? dB', tooltip: 'Unknown model' };
  const pct = percentileLabel ? ` · ${percentileLabel}` : '';
  return `<span class="badge badge--ref result-card__model-badge" title="${info.tooltip}">${info.label} · ${info.margin}${pct}</span>`;
}

/**
 * Render one badge model into a span (group header, section header or strip
 * icon). `badge` of null/undefined hides the element. Pure-DOM helper — the
 * testable model above stays DOM-free.
 */
export function renderBadge(el, badge) {
  if (!el) return;
  el.classList.remove('gl-badge--count', 'gl-badge--check', 'gl-badge--dot');
  if (!badge) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.classList.add('gl-badge', `gl-badge--${badge.type}`);
  el.textContent = badge.type === 'count' ? String(badge.value) : badge.type === 'check' ? '✓' : '';
  if (badge.type === 'dot') el.setAttribute('title', 'Plan outdated');
  else el.removeAttribute('title');
  el.hidden = false;
}

export function computeBadges(state = {}) {
  const { objectCount = 0, aoiSet = false, arsenalCount = 0, stale = false } = state;

  const modules = {};
  if (objectCount > 0) modules.objects = { type: 'count', value: objectCount };
  if (aoiSet) modules.aoi = { type: 'check' };
  modules.radios = { type: 'count', value: arsenalCount };
  if (stale) modules.coverage = { type: 'dot' };

  const groups = {};
  for (const g of NAV_GROUPS) {
    const members = g.modules.map((m) => modules[m]).filter(Boolean);
    if (!members.length) continue;
    if (members.some((b) => b.type === 'dot')) {
      groups[g.key] = { type: 'dot' };
      continue;
    }
    const counts = members.filter((b) => b.type === 'count');
    if (counts.length) {
      groups[g.key] = { type: 'count', value: counts.reduce((n, b) => n + b.value, 0) };
      continue;
    }
    if (members.some((b) => b.type === 'check')) groups[g.key] = { type: 'check' };
  }
  return { modules, groups };
}
