/**
 * M6 — Comms-plan report export (client-side, zero dependency).
 *
 * Renders a PACE plan (`buildPace` output) into a polished, self-contained
 * report and exports it in the formats the user ticks:
 *   • PDF   — opens a print-optimised report in a new tab and triggers the
 *             browser print dialog → "Save as PDF". Highest fidelity, no deps.
 *   • Word  — an `application/msword` .doc Blob (HTML Word opens + edits).
 *   • Excel — an `application/vnd.ms-excel` .xls Blob of the plan tables.
 *
 * OPSEC: everything is built and downloaded in the browser. No site
 * coordinates are ever uploaded or committed — the report carries only the
 * user's own runtime mission data, generated locally.
 *
 * See docs/decisions/0003-report-export.md for the zero-dependency rationale
 * and the (later) true-OOXML option.
 */

const TIER_COLOR = {
  Primary: '#1d9e75',
  Alternate: '#2f7fd1',
  Contingency: '#c9821a',
  Emergency: '#c8434f',
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Export the plan in the chosen formats.
 * @returns {{ done:string[], popupBlocked:boolean }}
 */
export function exportReport(plan, formats = {}) {
  const done = [];
  let popupBlocked = false;
  const stamp = reportStamp(plan);

  if (formats.pdf) {
    const ok = openPrintable(buildDocHtml(plan, { autoPrint: true, toolbar: true }));
    if (ok) done.push('PDF');
    else {
      popupBlocked = true;
      // Popup blocked → fall back to a downloadable standalone HTML report.
      downloadBlob(buildDocHtml(plan, { autoPrint: false, toolbar: true }), 'text/html;charset=utf-8', `GroundLink-comms-plan_${stamp}.html`);
      done.push('HTML (popup blocked)');
    }
  }
  if (formats.word) {
    downloadBlob(buildDocHtml(plan, { autoPrint: false, toolbar: false }), 'application/msword', `GroundLink-comms-plan_${stamp}.doc`);
    done.push('Word');
  }
  if (formats.excel) {
    downloadBlob(buildTablesHtml(plan), 'application/vnd.ms-excel', `GroundLink-comms-plan_${stamp}.xls`);
    done.push('Excel');
  }
  return { done, popupBlocked };
}

// ── Document (PDF / Word) ────────────────────────────────────────────────────

export function buildDocHtml(plan, { autoPrint = false, toolbar = false } = {}) {
  const c = plan.context || {};
  const build = c.build || {};
  const gen = c.generatedAt || new Date().toISOString();
  const buildLine = build.version
    ? `${(build.channel || 'alpha').toUpperCase()} · build ${build.version}+${build.sha} · ${build.date}`
    : 'local build';

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1a1d1c; background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { max-width: 820px; margin: 0 auto; padding: 32px 36px 56px; }
    h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a635f;
      margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e3e7e5; }
    .sub { color: #6b736f; font-size: 12px; }
    .accent { color: #0f7d63; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 2px; }
    th, td { text-align: left; padding: 7px 9px; vertical-align: top; font-variant-numeric: tabular-nums; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b736f; border-bottom: 1px solid #e3e7e5; }
    tbody tr { border-bottom: 1px solid #eef1f0; }
    .pace td { border-left: 4px solid transparent; }
    .tier { font-weight: 700; white-space: nowrap; }
    .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; }
    .bearer { font-weight: 600; }
    .gap td { color: #9aa19d; }
    .why { color: #4d544f; font-size: 12px; }
    .kv { display: grid; grid-template-columns: 180px 1fr; gap: 2px 14px; margin: 2px 0; }
    .kv dt { color: #6b736f; }
    .kv dd { margin: 0; font-variant-numeric: tabular-nums; }
    .summary { background: #f3f7f5; border: 1px solid #e0e8e4; border-left: 4px solid #1d9e75;
      border-radius: 6px; padding: 12px 14px; margin: 10px 0 2px; }
    .note { color: #6b736f; font-size: 12px; margin: 6px 0 0; }
    .caveats li { margin: 3px 0; color: #4d544f; }
    footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e3e7e5; color: #8a918d; font-size: 11px; }
    .toolbar { position: sticky; top: 0; background: #11201c; color: #cfe9e0; padding: 10px 16px;
      display: flex; gap: 12px; align-items: center; justify-content: space-between; font-size: 12px; }
    .toolbar button { background: #1d9e75; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
    @media print { .toolbar { display: none; } .page { padding: 0; max-width: none; } @page { margin: 16mm; } }
  `;

  const toolbarHtml = toolbar
    ? `<div class="toolbar"><span>GroundLink comms plan — use your browser's “Save as PDF”.</span><button onclick="window.print()">Print / Save as PDF</button></div>`
    : '';
  const autoPrintScript = autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print()}catch(e){}},350)});<\/script>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GroundLink — Comms plan</title><style>${css}</style></head>
<body>${toolbarHtml}<div class="page">
  <header>
    <h1>Comms plan <span class="accent">· GroundLink</span></h1>
    <div class="sub">${esc(buildLine)} — generated ${esc(fmtDateTime(gen))}</div>
  </header>

  <div class="summary">${esc(plan.summary || '')}</div>

  <h2>PACE plan</h2>
  ${paceTable(plan)}

  <h2>Comms structure</h2>
  ${structureBlock(plan)}

  <h2>Mission &amp; link parameters</h2>
  ${paramsBlock(plan)}

  <h2>Radio mix</h2>
  ${mixTable(plan)}

  <h2>Caveats</h2>
  <ul class="caveats">
    <li>Planning-grade, not survey-grade: FSPL + single knife-edge diffraction over ~30–90 m DEM. Verify in the field.</li>
    <li>HF NVIS is a separate module — no coverage raster in this build; treated as a beyond-line-of-sight leg only.</li>
    <li>Imported radio specs are a strong starting point, not a channel plan — confirm against your actual configuration.</li>
    <li>Coordinates shown are your runtime mission data, generated locally in the browser and not uploaded.</li>
  </ul>

  <footer>
    Generated locally by GroundLink (${esc(buildLine)}). Client-side only — nothing was uploaded.
    PACE roles are rule-based and explainable; review before operational use.
  </footer>
</div>${autoPrintScript}</body></html>`;
}

// ── Tables-only document (Excel) ─────────────────────────────────────────────

export function buildTablesHtml(plan) {
  const c = plan.context || {};
  const build = c.build || {};
  const head = `<tr><td colspan="4"><b>GroundLink — Comms plan</b></td></tr>
    <tr><td colspan="4">${esc(build.version ? `${(build.channel || 'alpha').toUpperCase()} build ${build.version}+${build.sha} · ${build.date}` : 'local build')} — generated ${esc(fmtDateTime(c.generatedAt || new Date().toISOString()))}</td></tr>
    <tr><td colspan="4"></td></tr>`;

  const pace = `<tr><th>Tier</th><th>Bearer</th><th>Role</th><th>Rationale</th></tr>` +
    plan.legs.map((l) => `<tr><td>${esc(l.tier)}</td><td>${esc(bearer(l))}</td><td>${esc(l.role)}</td><td>${esc(l.why)}</td></tr>`).join('');

  const sites = sitesRows(plan);
  const sitesTbl = `<tr><td colspan="4"></td></tr><tr><td colspan="4"><b>Comms structure — sites</b></td></tr>` +
    `<tr><th>#</th><th>Name</th><th>Type</th><th>Lat / Lng / Elev</th></tr>` +
    (sites.length
      ? sites.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.type)}</td><td>${esc(`${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}${s.elevM != null ? ` · ${Math.round(s.elevM)} m` : ''}`)}</td></tr>`).join('')
      : `<tr><td colspan="4">No fixed or recommended sites — standalone net.</td></tr>`);

  const mix = `<tr><td colspan="4"></td></tr><tr><td colspan="4"><b>Radio mix</b></td></tr>` +
    `<tr><th>Rank</th><th>Band</th><th>PACE</th><th>Rationale</th></tr>` +
    ((c.mix?.bands || []).map((b) => `<tr><td>${b.rank}</td><td>${esc(b.band)}</td><td>${esc(b.pace)}</td><td>${esc(b.why)}</td></tr>`).join('') || `<tr><td colspan="4">No mix — run “Recommend radio mix”.</td></tr>`);

  const params = `<tr><td colspan="4"></td></tr><tr><td colspan="4"><b>Mission &amp; link parameters</b></td></tr>` +
    paramRows(plan).map(([k, v]) => `<tr><td>${esc(k)}</td><td colspan="3">${esc(v)}</td></tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<table border="1">${head}${pace}${sitesTbl}${mix}${params}</table></body></html>`;
}

// ── Section builders ─────────────────────────────────────────────────────────

function paceTable(plan) {
  const rows = plan.legs
    .map((l) => {
      const col = TIER_COLOR[l.tier] || '#888';
      const gap = l.status === 'gap' ? ' gap' : '';
      const tag = l.status === 'separate' ? ' <span class="sub">(separate module)</span>'
        : l.status === 'asset' ? ' <span class="sub">(asset — no raster)</span>' : '';
      return `<tr class="${gap.trim()}"><td class="tier" style="border-left-color:${col}">` +
        `<span class="chip" style="background:${col}">${esc(l.tier)}</span></td>` +
        `<td class="bearer">${esc(bearer(l))}${tag}</td>` +
        `<td>${esc(l.role)}</td><td class="why">${esc(l.why)}</td></tr>`;
    })
    .join('');
  return `<table class="pace"><thead><tr><th>Tier</th><th>Bearer</th><th>Role</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function structureBlock(plan) {
  const s = plan.structure;
  const sites = sitesRows(plan);
  const overlay = plan.overlays?.length
    ? `<p class="note">Telemetry overlay: ${plan.overlays.map((o) => `${esc(o.band)} — ${esc(o.why)}`).join('; ')}</p>`
    : '';
  const table = sites.length
    ? `<table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Latitude</th><th>Longitude</th><th>Elev</th></tr></thead><tbody>` +
      sites.map((st, i) => `<tr><td>${i + 1}</td><td>${esc(st.name)}</td><td>${esc(st.type)}</td><td>${st.lat.toFixed(5)}</td><td>${st.lng.toFixed(5)}</td><td>${st.elevM != null ? `${Math.round(st.elevM)} m` : '—'}</td></tr>`).join('') +
      `</tbody></table>`
    : '';
  return `<p class="note"><b>${esc(cap(s.topology))}</b> — ${esc(s.note)}</p>${table}${overlay}`;
}

function paramsBlock(plan) {
  const rows = paramRows(plan).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return `<dl class="kv">${rows}</dl>`;
}

function mixTable(plan) {
  const bands = plan.context?.mix?.bands || [];
  if (!bands.length) return `<p class="note">No mix yet — run “Recommend radio mix”.</p>`;
  const rows = bands
    .map((b) => `<tr><td>${b.rank}</td><td class="bearer">${esc(b.band)}</td><td><span class="chip" style="background:${TIER_COLOR[b.pace] || '#888'}">${esc(b.pace)}</span></td><td class="why">${esc(b.why)}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Rank</th><th>Band</th><th>PACE</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ── Data shaping ─────────────────────────────────────────────────────────────

function sitesRows(plan) {
  const { fixed = [], recommended = [] } = plan.context?.sites || {};
  const out = [];
  fixed.forEach((s, i) => out.push({ name: s.name || `Site ${i + 1}`, type: 'Fixed', lat: s.lat, lng: s.lng, elevM: s.elevM ?? null }));
  recommended.forEach((s, i) => out.push({ name: s.label || `Mast ${i + 1}`, type: 'Recommended', lat: s.lat, lng: s.lng, elevM: s.elevM ?? null }));
  return out;
}

function paramRows(plan) {
  const c = plan.context || {};
  const p = c.params || {};
  const m = c.mission || {};
  const cov = c.coverage;
  const rows = [];
  rows.push(['Frequency', p.freqMHz != null ? `${p.freqMHz} MHz` : '—']);
  rows.push(['Tx power', p.powerW != null ? `${p.powerW} W` : '—']);
  rows.push(['Tx height (repeater)', p.txHeightM != null ? `${p.txHeightM} m` : '—']);
  rows.push(['Rx height (talk-in)', p.rxHeightM != null ? `${p.rxHeightM} m` : '—']);
  rows.push(['Propagation', p.engine || (p.useTerrain ? 'FSPL + terrain' : 'FSPL · flat')]);
  if (m.hasAoi) rows.push(['AOI', `${cap(m.aoiType || 'area')}${m.aoiAreaKm2 ? ` · ${m.aoiAreaKm2.toFixed(m.aoiAreaKm2 >= 100 ? 0 : 1)} km²` : ''}`]);
  if (m.routeLengthKm) rows.push(['Route length', `${m.routeLengthKm.toFixed(1)} km`]);
  if (m.points) rows.push(['Demand points', String(m.points)]);
  if (cov && Number.isFinite(cov.coveredFrac)) rows.push(['Coverage (last run)', `${Math.round(cov.coveredFrac * 100)}% of demand${cov.terrain ? ' · terrain-aware' : ' · flat'}`]);
  if (c.drone?.relay) rows.push(['Airborne relay', `active${c.drone.altitudeM != null ? ` @ ${Math.round(c.drone.altitudeM)} m` : ''}`]);
  return rows;
}

// ── Browser helpers ──────────────────────────────────────────────────────────

function openPrintable(html) {
  let w;
  try {
    w = window.open('', '_blank');
  } catch {
    return false;
  }
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob(['﻿', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ── Formatting ───────────────────────────────────────────────────────────────

function bearer(l) {
  if (l.status === 'gap') return '— not filled —';
  return l.band || l.asset || '—';
}
function reportStamp(plan) {
  const d = plan.context?.generatedAt || plan.context?.build?.date || new Date().toISOString();
  return String(d).slice(0, 10);
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function cap(s) {
  return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
