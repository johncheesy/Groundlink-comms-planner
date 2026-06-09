/**
 * Inline SVG radar (spider) chart for a radio's headline qualities — pure
 * DOM/SVG, no library. Five axes scored 1–5 from the radio spec, with graceful
 * fallbacks for fields the library does not carry (weight, modes, MIL tag).
 *
 *   Range        maxRangeM / 50000 × 5   (estimated from band + power if absent)
 *   Power        powerW capped at 20 W → 5
 *   Weight       inverse: <0.5 kg = 5, >5 kg = 1
 *   Versatility  supported modes / 4 × 5 (mid-score when unknown)
 *   Ruggedness   MIL-SPEC / MIL-STD / IP-rated tag → 5, else 3
 */

const AXES = ['Range', 'Power', 'Weight', 'Versatility', 'Ruggedness'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Estimate max range (m) when not provided: lower band + more power reaches further. */
function estimateRangeM(radio) {
  if (Number.isFinite(Number(radio.maxRangeM))) return Number(radio.maxRangeM);
  const f = Number(radio.defaultFreqMHz) || 150;
  const p = Number(radio.powerW) || 1;
  const bandFactor = f < 30 ? 4 : f < 300 ? 1 : f < 1000 ? 0.6 : 0.3;
  return clamp(6000 * bandFactor * Math.sqrt(p / 5), 500, 50000);
}

/** Score the five axes (each 1–5) from a radio spec. */
export function scoreRadio(radio = {}) {
  const range = clamp((estimateRangeM(radio) / 50000) * 5, 1, 5);
  const power = clamp(((Number(radio.powerW) || 0) / 20) * 5, 1, 5);
  const wKg = Number(radio.weightKg ?? radio.weight);
  const weight = Number.isFinite(wKg)
    ? wKg < 0.5 ? 5 : wKg > 5 ? 1 : clamp(5 - ((wKg - 0.5) / 4.5) * 4, 1, 5)
    : 3;
  const modes = Array.isArray(radio.modes) ? radio.modes.length : null;
  const versatility = modes != null ? clamp((modes / 4) * 5, 1, 5) : 3;
  const milTag = /mil[-\s]?spec|mil[-\s]?std|810|ip6[0-9]/i.test(
    `${radio.notes || ''} ${radio.label || ''} ${radio.milSpec || ''}`,
  );
  const ruggedness = milTag ? 5 : 3;
  return [range, power, weight, versatility, ruggedness];
}

/** Return an inline SVG radar chart (string) for a radio at the given pixel size. */
export function radarSvg(radio = {}, size = 220) {
  const scores = scoreRadio(radio);
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.33;
  const n = AXES.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const ring = (level) =>
    AXES.map((_, i) => pt(i, (R * level) / 5).map((v) => v.toFixed(1)).join(',')).join(' ');

  const grid = [1, 2, 3, 4, 5]
    .map((l) => `<polygon points="${ring(l)}" fill="none" stroke="var(--hair)" stroke-width="1" />`)
    .join('');
  const spokes = AXES.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--hair)" stroke-width="1" />`;
  }).join('');
  const dataPts = scores.map((s, i) => pt(i, (R * s) / 5).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = AXES.map((name, i) => {
    const [x, y] = pt(i, R + 14);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x < cx ? 'end' : 'start';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="10" fill="var(--dim)">${name}</text>`;
  }).join('');

  return (
    `<svg class="radar" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(radio.label || 'radio')} capability radar">` +
    grid +
    spokes +
    `<polygon points="${dataPts}" fill="var(--accent)" fill-opacity="0.22" stroke="var(--accent)" stroke-width="1.6" />` +
    scores.map((s, i) => { const [x, y] = pt(i, (R * s) / 5); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="var(--accent)" />`; }).join('') +
    labels +
    `</svg>`
  );
}

const trimNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** Render the full radio detail (spec block + radar) into a container element. */
export function renderRadarChart(radio, container) {
  if (!container || !radio) return;
  const fr = Array.isArray(radio.freqRangeMHz) ? radio.freqRangeMHz : [radio.defaultFreqMHz, radio.defaultFreqMHz];
  const freq = `${trimNum(Number(fr[0]) || 0)}–${trimNum(Number(fr[1]) || 0)} MHz`;
  const manufacturer = radio.manufacturer || (radio.label || '').split(' ')[0] || '—';
  const wKg = Number(radio.weightKg ?? radio.weight);
  const weight = Number.isFinite(wKg) ? `${trimNum(wKg)} kg` : '—';
  const battery = Number.isFinite(Number(radio.batteryMah))
    ? `${Math.round(Number(radio.batteryMah))} mAh${Number.isFinite(Number(radio.batteryV)) ? ` · ${trimNum(Number(radio.batteryV))} V` : ''}`
    : '—';

  container.innerHTML =
    `<div class="radio-detail__head"><strong class="radio-detail__name">${esc(radio.label || 'Radio')}</strong>` +
    `<span class="radio-detail__role" data-numeric>${esc(radio.role || '')}</span></div>` +
    `<dl class="radio-detail__specs" data-numeric>` +
    `<div><dt>Manufacturer</dt><dd>${esc(manufacturer)}</dd></div>` +
    `<div><dt>Frequency</dt><dd>${esc(freq)}</dd></div>` +
    `<div><dt>Power</dt><dd>${esc(trimNum(Number(radio.powerW) || 0))} W</dd></div>` +
    `<div><dt>Weight</dt><dd>${esc(weight)}</dd></div>` +
    `<div><dt>Battery</dt><dd>${esc(battery)}</dd></div>` +
    `</dl>` +
    `<div class="radio-detail__chart">${radarSvg(radio)}</div>`;
}
