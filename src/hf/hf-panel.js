// HF ionosphere panel (M12) — controls + results UI.
//
// Renders date/time, solar-cycle and path-length controls, then an at-a-glance
// summary, an SVG band chart (LUF / MUF window over 0–30 MHz) and a per-band
// viability list. All numbers come from computeHfConditions(); this module is
// presentation only.

import { computeHfConditions } from './ionosphere.js';

const NS = 'http://www.w3.org/2000/svg';
const CHART_MAX = 30; // MHz — right edge of the band chart

function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

// Two-digit zero-pad for the datetime-local default.
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Build the panel inside `container`.
 * @param {HTMLElement} container
 * @param {{ onParamsChange?: () => void }} [opts]
 * @returns {{ update: (lat:number, lng:number, dt:Date, pathKm:number, solarCycle:string) => void,
 *            getParams: () => { dt:Date, pathKm:number, solarCycle:string } }}
 */
export function createHfPanel(container, { onParamsChange } = {}) {
  container.innerHTML = `
    <div class="hf-controls">
      <div class="input-row">
        <label class="field-label" style="flex:1">Date / time (UTC)
          <input class="input input--sm" type="datetime-local" id="hfDatetime" />
        </label>
      </div>
      <div class="input-row">
        <label class="field-label" style="flex:1">Solar cycle
          <select class="input input--sm" id="hfSolarCycle">
            <option value="low">Low — quiet sun</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High — active sun</option>
          </select>
        </label>
        <label class="field-label" style="flex:1">Path
          <div class="input-row">
            <input class="input input--sm" type="number" id="hfPathKm" min="0" max="10000" step="50" value="0" />
            <span class="input-suffix">km</span>
          </div>
        </label>
      </div>
    </div>
    <div class="hf-results" id="hfResults"></div>
    <p class="help">Climatological estimate (planning-grade). NVIS for short/local paths,
    skywave for DX. Set path to 0 for an overhead (NVIS) assessment.</p>
  `;

  const dtInput = container.querySelector('#hfDatetime');
  const cycleInput = container.querySelector('#hfSolarCycle');
  const pathInput = container.querySelector('#hfPathKm');
  const results = container.querySelector('#hfResults');

  // Default the date/time control to now (local fields for the picker).
  (function setNow() {
    const now = new Date();
    dtInput.value =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  })();

  for (const el of [dtInput, cycleInput, pathInput]) {
    el.addEventListener('change', () => onParamsChange?.());
    el.addEventListener('input', () => onParamsChange?.());
  }

  function getParams() {
    return {
      dt: dtInput.value ? new Date(dtInput.value) : new Date(),
      pathKm: Math.max(0, Number(pathInput.value) || 0),
      solarCycle: cycleInput.value || 'medium',
    };
  }

  // ---- SVG band chart: LUF zone (red) · LUF→MUF (green) · MUF→30 (red) ----
  function bandChart(c) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'hf-band-chart');
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Band window: LUF ${fmt(c.luf)} to MUF ${fmt(c.muf)} MHz`);

    const x = (mhz) => Math.max(0, Math.min(100, (mhz / CHART_MAX) * 100));
    const rect = (x0, w, cls) => {
      if (w <= 0) return;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x0);
      r.setAttribute('y', 8);
      r.setAttribute('width', w);
      r.setAttribute('height', 20);
      r.setAttribute('class', cls);
      svg.appendChild(r);
    };
    const tick = (mhz, label) => {
      const px = x(mhz);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', px);
      line.setAttribute('x2', px);
      line.setAttribute('y1', 4);
      line.setAttribute('y2', 32);
      line.setAttribute('class', 'hf-tick');
      svg.appendChild(line);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', Math.max(2, Math.min(92, px)));
      t.setAttribute('y', 39);
      t.setAttribute('class', 'hf-tick-label');
      t.textContent = label;
      svg.appendChild(t);
    };

    const lufX = x(c.luf);
    const mufX = x(c.muf);
    rect(0, lufX, 'hf-zone hf-zone--no'); // below LUF — absorbed
    rect(lufX, Math.max(0, mufX - lufX), 'hf-zone hf-zone--ok'); // usable window
    rect(mufX, Math.max(0, 100 - mufX), 'hf-zone hf-zone--no'); // above MUF — penetrates

    tick(c.foF2, 'foF2');
    tick(c.ouf, 'OWF');
    tick(c.muf, 'MUF');
    return svg;
  }

  function modeClass(mode) {
    if (mode === 'nvis' || mode === 'both') return 'hf-summary-line--nvis';
    if (mode === 'skywave') return 'hf-summary-line--skywave';
    return 'hf-summary-line--none';
  }
  function modeText(c) {
    const label = {
      nvis: 'NVIS viable',
      skywave: 'Skywave viable',
      both: 'NVIS + skywave',
      none: 'No HF path',
    }[c.mode];
    return `${label} · OWF ${fmt(c.ouf)} MHz · MUF ${fmt(c.muf)} MHz`;
  }

  function render(c) {
    results.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = `hf-summary-line ${modeClass(c.mode)}`;
    summary.textContent = modeText(c);
    results.appendChild(summary);

    const sub = document.createElement('p');
    sub.className = 'help hf-sub';
    const dayNight = c.solarZenith < 90 ? `day (sun ${fmt(90 - c.solarZenith, 0)}° up)` : 'night';
    sub.textContent =
      `foF2 ${fmt(c.foF2)} MHz · LUF ${fmt(c.luf)} MHz · ${dayNight} · ${c.season}`;
    results.appendChild(sub);

    results.appendChild(bandChart(c));

    const list = document.createElement('div');
    list.className = 'hf-band-list';
    for (const b of c.bands) {
      const row = document.createElement('div');
      row.className = 'hf-band-row';
      const dot = document.createElement('span');
      dot.className = `hf-band-dot hf-band-dot--${b.status}`;
      const name = document.createElement('span');
      name.className = 'hf-band-name';
      name.textContent = b.band;
      const reason = document.createElement('span');
      reason.className = 'hf-band-reason';
      reason.textContent = b.reason;
      row.append(dot, name, reason);
      list.appendChild(row);
    }
    results.appendChild(list);
  }

  function update(lat, lng, dt, pathKm, solarCycle) {
    const cond = computeHfConditions({ lat, lng, dt, pathKm, solarCycle });
    render(cond);
  }

  return { update, getParams };
}
