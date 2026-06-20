/**
 * M38 — Satcom panel UI.
 *
 * Renders inside the left-panel "Satcom" section:
 *   • GEO satellite look-angle table (elevation, azimuth, status ring)
 *   • LEO system availability badges
 *   • Best-satellite recommendation
 *
 * Usage:
 *   const panel = createSatcomPanel(hostEl, { onCentroidNeeded });
 *   panel.update({ lat, lng });   // call when AOI changes
 *   panel.clear();                // call when no AOI is set
 */

import { satcomAssessment, LEO_SYSTEMS } from '../connectivity/satcom.js';
import { rainAttenuation } from '../analysis/rain-fade.js';

// ── M44: Rain-fade helpers ─────────────────────────────────────────────────

// Detect a GHz centre frequency for rain-fade from the satellite's band string.
// Returns null for bands where rain fade is negligible (L/S/C/X).
function bandToFreqGhz(band) {
  if (!band) return null;
  const b = band.toUpperCase();
  if (b.includes('KA')) return 20;  // Ka-band (20 GHz uplink conservative)
  if (b.includes('KU')) return 12;  // Ku-band
  return null; // L, S, C, X — rain fade negligible
}

// Returns { tier, a99, a999 } or null when band is L/S/C/X.
function computeFade(sat, lat, lng) {
  const freqGhz = bandToFreqGhz(sat.band);
  if (!freqGhz || sat.elevation < 0) return null;
  try {
    const { A } = rainAttenuation({
      latDeg: lat, lngDeg: lng,
      elevDeg: Math.max(sat.elevation, 5),
      freqGhz,
    });
    const a99  = A[0];  // attenuation exceeded 1% of time
    const a999 = A[2];  // attenuation exceeded 0.1% of time
    const tier = a99 < 3 ? 'ok' : a99 < 8 ? 'warn' : 'bad';
    return { tier, a99, a999 };
  } catch (_) { return null; }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const e = (tag, cls, ...children) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (c == null) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

const fmtDeg = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

const ELEVATION_COLORS = {
  ok:       'var(--ok)',
  warn:     'var(--warn)',
  marginal: 'var(--bad)',
  below:    'var(--faint)',
};

const STATUS_LABELS = {
  ok:       'Good',
  warn:     'Marginal',
  marginal: 'Low',
  below:    'Below horizon',
};

/**
 * Render a small SVG elevation-angle arc indicator.
 * The arc is a 180° protractor; elevation is marked by a needle.
 * @param {number} elevation  degrees (-10…90)
 * @returns {SVGElement}
 */
function elevationArc(elevation) {
  const W = 48, H = 28, CX = 24, CY = 27, R = 22;
  const clampedEl = Math.max(-10, Math.min(90, elevation));
  // Map elevation -10°→90° to arc position 190°→350° (going left to right)
  const angle = 180 - clampedEl * 2; // 0°el → 180° (left), 90°el → 0° (top)
  const rad = (angle - 90) * (Math.PI / 180);
  const nx = CX + R * Math.cos(rad);
  const ny = CY + R * Math.sin(rad);
  const color = ELEVATION_COLORS[elevation >= 20 ? 'ok' : elevation >= 5 ? 'warn' : elevation >= 0 ? 'marginal' : 'below'];

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'satcom-arc');

  // Background arc (grey half circle)
  const bgArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bgArc.setAttribute('d', `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`);
  bgArc.setAttribute('fill', 'none');
  bgArc.setAttribute('stroke', 'var(--hair)');
  bgArc.setAttribute('stroke-width', '2');
  svg.appendChild(bgArc);

  // Horizon line
  const hline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hline.setAttribute('x1', String(CX - R - 2));
  hline.setAttribute('y1', String(CY));
  hline.setAttribute('x2', String(CX + R + 2));
  hline.setAttribute('y2', String(CY));
  hline.setAttribute('stroke', 'var(--hair2)');
  hline.setAttribute('stroke-width', '0.8');
  svg.appendChild(hline);

  if (elevation >= -10) {
    // Elevation needle
    const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    needle.setAttribute('x1', String(CX));
    needle.setAttribute('y1', String(CY));
    needle.setAttribute('x2', String(nx.toFixed(1)));
    needle.setAttribute('y2', String(ny.toFixed(1)));
    needle.setAttribute('stroke', color);
    needle.setAttribute('stroke-width', '2');
    needle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(needle);

    // Dot at needle tip
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(nx.toFixed(1)));
    dot.setAttribute('cy', String(ny.toFixed(1)));
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
  }

  // Center dot
  const cdot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  cdot.setAttribute('cx', String(CX));
  cdot.setAttribute('cy', String(CY));
  cdot.setAttribute('r', '2');
  cdot.setAttribute('fill', 'var(--dim)');
  svg.appendChild(cdot);

  return svg;
}

// ── Panel factory ──────────────────────────────────────────────────────────

export function createSatcomPanel(host, { onCentroidNeeded } = {}) {
  host.innerHTML = '';

  // Placeholder state
  function showPlaceholder() {
    host.innerHTML = '';
    const ph = e('div', 'satcom-placeholder');
    ph.innerHTML =
      `<p class="satcom-placeholder__text">Define a mission area to see satellite look angles.</p>`;
    if (onCentroidNeeded) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--sm';
      btn.textContent = 'Define AOI';
      btn.addEventListener('click', () => onCentroidNeeded());
      ph.append(btn);
    }
    host.append(ph);
  }

  // Pre-compute fade for all GEO sats at this lat/lng (M44)
  function buildFadeMap(geoSats, lat, lng) {
    const map = {};
    for (const sat of geoSats) {
      map[sat.id] = computeFade(sat, lat, lng);
    }
    return map;
  }

  function render(assessment, lat, lng) {
    host.innerHTML = '';

    // ── Best GEO recommendation ──────────────────────────────────────────
    const best = assessment.bestGeo;
    const summary = e('div', 'satcom-summary');
    if (best) {
      const color =
        best.status === 'ok' ? 'var(--ok)' :
        best.status === 'warn' ? 'var(--warn)' : 'var(--bad)';
      summary.innerHTML =
        `<div class="satcom-summary__label">Best GEO satellite</div>` +
        `<div class="satcom-summary__best" style="--sat-color:${color}">` +
        `<span class="satcom-summary__name">${best.label}</span>` +
        `<span class="satcom-summary__el">${fmtDeg(best.elevation)} elevation</span>` +
        `<span class="satcom-summary__az">Az ${Math.round(best.azimuth)}°</span>` +
        `</div>`;
    } else {
      summary.innerHTML =
        `<div class="satcom-summary__label">GEO coverage</div>` +
        `<div class="satcom-summary__best satcom-summary__best--none">No GEO satellite visible above horizon at this location.</div>`;
    }
    host.append(summary);

    // ── GEO table ────────────────────────────────────────────────────────
    const fadeMap = buildFadeMap(assessment.geo, lat, lng); // M44

    const geoWrap = e('div', 'satcom-geo');
    const geoHd = e('div', 'satcom-section-hd', 'GEO Satellites');
    geoWrap.append(geoHd);

    for (const sat of assessment.geo) {
      const row = e('div', `satcom-row satcom-row--${sat.status}`);

      const arc = elevationArc(sat.elevation);

      const info = e('div', 'satcom-row__info');
      info.innerHTML =
        `<span class="satcom-row__name">${sat.label}</span>` +
        `<span class="satcom-row__net">${sat.network} · ${sat.band}</span>`;

      const nums = e('div', 'satcom-row__nums');
      const elClass = sat.status === 'ok' ? 'ok' : sat.status === 'warn' ? 'warn' : sat.status === 'marginal' ? 'bad' : 'faint';
      nums.innerHTML =
        `<span class="satcom-row__el satcom-el--${elClass}">${fmtDeg(sat.elevation)}</span>` +
        `<span class="satcom-row__az">Az ${Math.round(sat.azimuth)}°</span>`;

      // M44: fade margin badge for Ka/Ku bands
      const fade = fadeMap[sat.id];
      if (fade) {
        const fadeEl = e('div', `satcom-fade satcom-fade--${fade.tier}`);
        fadeEl.title = `Rain fade (ITU-R P.618-14, indicative ±3 dB)\n99%: ${fade.a99.toFixed(1)} dB  ·  99.9%: ${fade.a999.toFixed(1)} dB`;
        fadeEl.innerHTML =
          `<span class="satcom-fade__label">Rain fade</span>` +
          `<span class="satcom-fade__vals">` +
          `<span>99%&thinsp;<b>${fade.a99.toFixed(1)}</b>&thinsp;dB</span>` +
          `<span>99.9%&thinsp;<b>${fade.a999.toFixed(1)}</b>&thinsp;dB</span>` +
          `</span>`;
        row.append(arc, info, nums, fadeEl);
      } else {
        row.append(arc, info, nums);
      }
      geoWrap.append(row);
    }

    if (assessment.geo.length === 0) {
      geoWrap.append(e('p', 'satcom-empty', 'No GEO satellites visible from this position.'));
    }

    host.append(geoWrap);

    // ── LEO systems ──────────────────────────────────────────────────────
    const leoWrap = e('div', 'satcom-leo');
    const leoHd = e('div', 'satcom-section-hd', 'LEO / MEO Systems');
    leoWrap.append(leoHd);

    for (const sys of LEO_SYSTEMS) {
      const row = e('div', 'satcom-leo-row');
      const statusMod = sys.planningStatus === 'available' ? 'teal' : 'amber';
      row.innerHTML =
        `<span class="badge badge--${statusMod === 'teal' ? 'ok' : 'warn'} satcom-leo-badge">${sys.label}</span>` +
        `<span class="satcom-leo-net">${sys.constellation} · ${sys.bands}</span>`;
      const note = e('div', 'satcom-leo-note', sys.note);
      row.append(note);
      leoWrap.append(row);
    }

    host.append(leoWrap);

    // ── Footer note ──────────────────────────────────────────────────────
    const footer = e('p', 'satcom-footer',
      `Look angles from ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E. ` +
      `Terrain masking not included — confirm with path profile (M14).`);
    host.append(footer);

    // M44: accuracy note for rain-fade values
    const hasKaKu = assessment.geo.some((s) => bandToFreqGhz(s.band) != null);
    if (hasKaKu) {
      const fadeNote = e('p', 'satcom-fade-note',
        'Rain fade indicative ±3 dB · ITU-R P.618-14. Ka = 20 GHz, Ku = 12 GHz.');
      host.append(fadeNote);
    }
  }

  return {
    update({ lat, lng }) {
      try {
        const assessment = satcomAssessment(lat, lng);
        render(assessment, lat, lng);
      } catch (err) {
        console.error('satcom-panel: assessment failed', err);
        showPlaceholder();
      }
    },
    clear: showPlaceholder,
  };
}
