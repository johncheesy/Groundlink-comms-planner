/**
 * Mast-height wizard (M35) — link mode. A floating drawer (profile-panel
 * pattern) for one selected mast/repeater/tx/drone: pick a link target, get
 * the minimum clearing height, see the path-profile preview with the clearing
 * ray, apply through the normal dirty/recompute/undo flow. Advisory only —
 * never auto-mutates.
 *
 * Heights are clearance-driven and planning-grade (same caveat as the M14
 * path profile). The drone's "height" is its AGL altitude, capped by ceiling.
 */

import { minHeightForLink, minHeightForLinks, DEFAULT_MAX_M } from '../analysis/mast-height.js';
import { linkBudget } from '../analysis/path-profile.js';
import { renderProfileChart } from '../analysis/profile-chart.js';
import { deygoutLossDb } from '../coverage/model.js';

const fmtKm = (m) => (m >= 10000 ? `${(m / 1000).toFixed(0)} km` : `${(m / 1000).toFixed(1)} km`);

/**
 * @param {HTMLElement} mapContainer
 * @param {object} deps
 * @param {object} deps.registry            M19 object registry
 * @param {() => object|null} deps.getAoi
 * @param {() => Array} deps.getPoints      demand points [{lat,lng,name}]
 * @param {() => number} deps.getFreqMHz
 * @param {() => number} deps.getRxHeightM
 * @param {() => number} deps.getEirpDbm
 * @param {() => number} deps.getThresholdDbm
 * @param {(entry) => number} deps.getMaxM  cap (mast 30 default / drone ceiling)
 * @param {(bounds) => Promise<{dem, clutter}>} deps.buildSamplers  E1 seam
 * @param {(entry, heightM) => void} deps.onApply
 * @param {(msg:string) => void} [deps.onStatus]
 */
export function createMastWizard(mapContainer, deps) {
  const panel = document.createElement('div');
  panel.className = 'profile-panel mast-wizard';
  panel.hidden = true;
  panel.innerHTML =
    `<div class="profile-panel__header">` +
    `<span class="profile-panel__title" id="mwTitle">Mast height</span>` +
    `<span class="profile-panel__meta" id="mwMeta" data-numeric></span>` +
    `<button type="button" class="profile-panel__close" aria-label="Close mast-height wizard" title="Close">×</button>` +
    `</div>` +
    `<div class="mast-wizard__controls">` +
    `<label class="field-label">Link target` +
    `<select class="input" id="mwTarget" aria-label="Link target"></select></label>` +
    `<label class="field-label">Fresnel clear` +
    `<select class="input" id="mwFresnel" aria-label="Fresnel clearance target">` +
    `<option value="0.6" selected>60% (standard)</option><option value="1">100% (strict)</option></select></label>` +
    `<label class="field-label">Max <span id="mwMaxLabel">mast</span>` +
    `<span class="input-row"><input class="input input--mini" id="mwMax" type="number" min="2" max="300" step="1" /><span class="input-suffix">m</span></span></label>` +
    `<button class="btn btn--primary" type="button" id="mwRun">Find height</button>` +
    `</div>` +
    `<div class="mast-wizard__result" id="mwResult" hidden>` +
    `<div class="mast-wizard__verdict"><span class="mast-wizard__height" id="mwHeight" data-numeric></span>` +
    `<span class="mast-wizard__obstacle" id="mwObstacle"></span></div>` +
    `<div class="profile-panel__body" id="mwChart"></div>` +
    `<div class="mast-wizard__actions">` +
    `<button class="btn btn--primary" type="button" id="mwApply"></button>` +
    `<p class="help">Clearance-driven, planning-grade — same caveats as the path profile. Applying re-runs the plan; ⌘Z undoes.</p>` +
    `</div></div>`;
  mapContainer.appendChild(panel);

  const $p = (sel) => panel.querySelector(sel);
  const titleEl = $p('#mwTitle');
  const metaEl = $p('#mwMeta');
  const targetSel = $p('#mwTarget');
  const fresnelSel = $p('#mwFresnel');
  const maxInput = $p('#mwMax');
  const maxLabel = $p('#mwMaxLabel');
  const runBtn = $p('#mwRun');
  const resultEl = $p('#mwResult');
  const heightEl = $p('#mwHeight');
  const obstacleEl = $p('#mwObstacle');
  const chartEl = $p('#mwChart');
  const applyBtn = $p('#mwApply');

  let entry = null;
  let lastResult = null; // { heightM, limited } of the last run

  /** Link-target option list for the current entry. */
  function targetOptions() {
    const opts = [];
    const aoi = deps.getAoi?.();
    if (aoi?.center) opts.push({ id: 'aoi', label: 'AOI centre', rx: aoi.center });
    const points = deps.getPoints?.() ?? [];
    if (points.length > 1) opts.push({ id: 'binding', label: `All demand points (binding of ${points.length})` });
    points.forEach((p, i) => opts.push({ id: `pt:${i}`, label: p.name || `Point ${i + 1}`, rx: p }));
    for (const e of deps.registry.byKind?.('tx') ?? []) pushSite(e);
    for (const e of deps.registry.byKind?.('mast') ?? []) pushSite(e);
    for (const e of deps.registry.byKind?.('repeater') ?? []) pushSite(e);
    function pushSite(e) {
      if (e.id === entry.id) return;
      opts.push({ id: `obj:${e.id}`, label: e.name, rx: { lat: e.lngLat[1], lng: e.lngLat[0] } });
    }
    return opts;
  }

  function renderTargets() {
    const opts = targetOptions();
    targetSel.innerHTML = opts
      .map((o, i) => `<option value="${o.id}"${i === 0 ? ' selected' : ''}>${o.label}</option>`)
      .join('');
    targetSel.disabled = !opts.length;
    runBtn.disabled = !opts.length;
    metaEl.textContent = opts.length ? '' : 'no link target — draw an AOI or add points';
    return opts;
  }

  async function run() {
    const opts = targetOptions();
    const chosen = opts.find((o) => o.id === targetSel.value) ?? opts[0];
    if (!chosen || !entry) return;
    const txPos = { lat: entry.lngLat[1], lng: entry.lngLat[0] };
    const points = deps.getPoints?.() ?? [];
    const rxList = chosen.id === 'binding' ? points : [chosen.rx];

    runBtn.disabled = true;
    deps.onStatus?.('Sampling terrain…');
    try {
      // One sampler window covering the mast and every rx end, padded 10%.
      const lats = [txPos.lat, ...rxList.map((r) => r.lat)];
      const lngs = [txPos.lng, ...rxList.map((r) => r.lng)];
      const pad = Math.max(0.01, (Math.max(...lats) - Math.min(...lats)) * 0.1, (Math.max(...lngs) - Math.min(...lngs)) * 0.1);
      const bounds = {
        west: Math.min(...lngs) - pad, east: Math.max(...lngs) + pad,
        south: Math.min(...lats) - pad, north: Math.max(...lats) + pad,
      };
      const { dem, clutter } = await deps.buildSamplers(bounds);

      const shared = {
        tx: txPos,
        freqMHz: deps.getFreqMHz(),
        rxHeightM: deps.getRxHeightM(),
        dem,
        clutter,
        fraction: Number(fresnelSel.value) || 0.6,
        minM: 2,
        maxM: Number(maxInput.value) || DEFAULT_MAX_M,
      };
      const res = chosen.id === 'binding'
        ? minHeightForLinks(points.map((p) => ({ rx: { lat: p.lat, lng: p.lng } })), shared)
        : minHeightForLink({ ...shared, rx: chosen.rx });
      const link = chosen.id === 'binding' ? res.results[res.bindingIndex] : res;
      const bindingName = chosen.id === 'binding'
        ? (points[res.bindingIndex]?.name || `Point ${res.bindingIndex + 1}`)
        : chosen.label;

      render(link, res.heightM, res.limited, bindingName, !!dem, !!clutter);
      deps.onStatus?.(res.limited ? 'No clearing height within the cap' : `Needs ≥ ${res.heightM} m`);
    } catch (err) {
      deps.onStatus?.(`Height search failed: ${err.message}`);
    } finally {
      runBtn.disabled = false;
    }
  }

  function render(link, heightM, limited, targetName, hasDem, hasClutter) {
    lastResult = { heightM, limited };
    const isDrone = entry.kind === 'drone';
    const unit = isDrone ? 'm AGL' : 'm';
    const ob = link.obstacle;
    const obText = ob
      ? `${fmtKm(ob.distM)} out (terrain ${Math.round(ob.terrainM)} m${ob.clutterM ? ` + clutter ${Math.round(ob.clutterM)} m` : ''})`
      : 'no obstruction';
    if (limited) {
      heightEl.textContent = `> ${Number(maxInput.value)} ${unit}`;
      obstacleEl.textContent =
        `Even ${maxInput.value} ${unit} leaves ${link.minClearanceM.toFixed(1)} m at the blocker ` +
        `${obText} on the ${targetName} link — consider relocating.`;
      applyBtn.hidden = true;
    } else {
      heightEl.textContent = `≥ ${heightM} ${unit}`;
      obstacleEl.textContent =
        `${targetName} link clears with ${link.minClearanceM.toFixed(1)} m margin` +
        (ob ? ` — limiting obstacle ${obText}` : ' — clear path') +
        (hasDem ? '' : ' · no terrain data (flat earth)') +
        (hasClutter ? '' : ''); // clutter presence is visible in the obstacle line
      applyBtn.hidden = false;
      applyBtn.textContent = `Apply ${heightM} ${unit}`;
    }

    // Path-profile preview with the clearing (or capped) ray — the M14 chart.
    const p = link.profile;
    const n = p.distances.length;
    const profilePts = p.distances.map((d, i) => ({ d, h: p.effective[i] }));
    const diffractionDb = deygoutLossDb(profilePts, p.txTipM, p.rxTipM, deps.getFreqMHz(), p.distanceM);
    let minIdx = 0;
    for (let i = 1; i < n; i++) if (p.clearances[i] < p.clearances[minIdx]) minIdx = i;
    renderProfileChart(chartEl, {
      distances: p.distances,
      elevations: p.effective,
      clearances: p.clearances,
      txElev: p.txTipM,
      rxElev: p.rxTipM,
      distanceKm: p.distanceM / 1000,
      distanceM: p.distanceM,
      minClearance: link.minClearanceM,
      minClearanceIdx: minIdx,
      obstructed: link.minClearanceM < 0,
      freqMHz: deps.getFreqMHz(),
      budget: linkBudget({
        distanceM: p.distanceM,
        freqMHz: deps.getFreqMHz(),
        txEirpDbm: deps.getEirpDbm(),
        rxThreshDbm: deps.getThresholdDbm(),
        diffractionDb,
      }),
    });
    resultEl.hidden = false;
  }

  const api = {
    isVisible: false,
    openFor(entryId) {
      entry = deps.registry.get(entryId);
      if (!entry) return;
      const isDrone = entry.kind === 'drone';
      titleEl.textContent = `${isDrone ? 'Relay altitude' : 'Mast height'} — ${entry.name}`;
      maxLabel.textContent = isDrone ? 'ceiling' : 'mast';
      maxInput.value = String(deps.getMaxM(entry));
      resultEl.hidden = true;
      lastResult = null;
      renderTargets();
      panel.hidden = false;
      api.isVisible = true;
      targetSel.focus();
    },
    hide() {
      panel.hidden = true;
      api.isVisible = false;
      entry = null;
    },
  };

  runBtn.addEventListener('click', run);
  applyBtn.addEventListener('click', () => {
    if (!entry || !lastResult || lastResult.limited) return;
    deps.onApply(entry, lastResult.heightM);
    api.hide();
  });
  $p('.profile-panel__close').addEventListener('click', () => api.hide());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.hide();
  });

  return api;
}
