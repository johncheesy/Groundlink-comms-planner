/**
 * M37 — Mission Brief generator.
 *
 * Assembles a print-ready HTML string from current app state and opens it in
 * a new browser tab (ready for Ctrl+P / print-to-PDF).
 *
 * No dependencies beyond built-in DOM APIs; all styles are inlined.
 * OPSEC: coordinates are included by default (the user chose to put them
 * in the mission). An optional maskCoords flag redacts them.
 */

/** @param {number} v */
const fmtKm2 = (v) =>
  v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' km²';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
const fmtCoord = (v, digits = 5) =>
  typeof v === 'number' ? v.toFixed(digits) : '—';

/**
 * Generate a print-ready HTML string for the mission brief.
 *
 * @param {object} opts
 * @param {string}         opts.missionName
 * @param {string|null}    opts.mapImageDataUrl   — map.getCanvas().toDataURL('image/png')
 * @param {object|null}    opts.coverageSummary   — from summarizeCoverage()
 * @param {object|null}    opts.paceResult        — from buildPace()
 * @param {Array}          opts.radios            — radio arsenal entries
 * @param {Array}          opts.linkBudgets       — M14 link budgets (optional)
 * @param {object}         opts.modelInfo         — { modelKey, label, margin, percentileLabel }
 * @param {string}         opts.buildVersion
 * @param {boolean}        [opts.maskCoords=false]
 * @returns {string} complete HTML document
 */
export function generateBrief({
  missionName = 'Mission',
  mapImageDataUrl = null,
  coverageSummary = null,
  paceResult = null,
  radios = [],
  linkBudgets = [],
  modelInfo = {},
  buildVersion = '',
  maskCoords = false,
} = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const coord = (v) => maskCoords ? '[redacted]' : fmtCoord(v);

  // ── Map image ──────────────────────────────────────────────────────────────
  const mapSection = mapImageDataUrl
    ? `<section class="brief-map">
        <img src="${esc(mapImageDataUrl)}" alt="Mission area map" />
        ${coverageSummary ? `<p class="brief-caption">Coverage: ${Math.round(coverageSummary.coveredPct ?? 0)}% · Model: ${esc(modelInfo.label ?? 'unknown')}</p>` : ''}
      </section>`
    : `<section class="brief-map brief-map--missing"><p>Map screenshot not available — reload and try again.</p></section>`;

  // ── PACE plan ──────────────────────────────────────────────────────────────
  let paceSection = '';
  if (paceResult?.legs?.length) {
    const rows = paceResult.legs.map((l) =>
      `<tr>
        <td>${esc(l.tier ?? '—')}</td>
        <td>${esc(l.band ?? '—')}</td>
        <td>${esc(l.status === 'recommend' ? 'Not carried — acquire' : l.radios?.length ? l.radios.join(', ') : l.asset ?? l.role ?? '—')}</td>
        <td>${esc(l.freqMHz ? l.freqMHz + ' MHz' : '—')}</td>
        <td>${esc(l.why ?? '')}</td>
      </tr>`,
    ).join('');
    paceSection = `<section class="brief-pace">
      <h2>PACE Plan</h2>
      <table>
        <thead><tr><th>Tier</th><th>Band</th><th>Asset / Method</th><th>Frequency</th><th>Rationale</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }

  // ── Radio configuration ────────────────────────────────────────────────────
  let radioSection = '';
  if (radios.length) {
    const rows = radios.map((r) =>
      `<tr>
        <td>${esc(r.callsign ?? r.name ?? '—')}</td>
        <td>${esc(r.model ?? r.brand ?? '—')}</td>
        <td>${esc(r.band ?? '—')}</td>
        <td>${esc(r.freqMHz ? r.freqMHz + ' MHz' : '—')}</td>
        <td>${esc(r.powerW ? r.powerW + ' W' : '—')}</td>
        <td>${esc(r.txHeightM ? r.txHeightM + ' m' : '—')}</td>
      </tr>`,
    ).join('');
    radioSection = `<section class="brief-radios">
      <h2>Radio Configuration</h2>
      <table>
        <thead><tr><th>Callsign / Site</th><th>Radio</th><th>Band</th><th>Freq (MHz)</th><th>Power (W)</th><th>Antenna height (m)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }

  // ── Link budgets ───────────────────────────────────────────────────────────
  let linkSection = '';
  if (linkBudgets.length) {
    const rows = linkBudgets.map((l) =>
      `<tr>
        <td>${esc(l.label ?? '—')}</td>
        <td>${esc(l.distKm != null ? l.distKm.toFixed(1) : '—')}</td>
        <td>${esc(l.fsplDb != null ? l.fsplDb.toFixed(1) : '—')}</td>
        <td class="${l.marginDb != null && l.marginDb < 0 ? 'brief-bad' : ''}">${esc(l.marginDb != null ? l.marginDb.toFixed(1) : '—')}</td>
        <td>${esc(l.marginDb != null ? (l.marginDb >= 0 ? '✓ OK' : '✗ Fail') : '—')}</td>
      </tr>`,
    ).join('');
    linkSection = `<section class="brief-links">
      <h2>Link Budgets</h2>
      <table>
        <thead><tr><th>Link</th><th>Dist (km)</th><th>FSPL (dB)</th><th>Margin (dB)</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="brief-note">Calculated with ${esc(modelInfo.label ?? '—')} ${esc(modelInfo.percentileLabel ? '· ' + modelInfo.percentileLabel : '')}</p>
    </section>`;
  }

  // ── Coverage summary ───────────────────────────────────────────────────────
  let covSection = '';
  if (coverageSummary) {
    const dz = coverageSummary.deadZones ?? [];
    covSection = `<section class="brief-coverage">
      <h2>Coverage Summary</h2>
      <dl>
        <dt>Covered area</dt><dd>${Math.round(coverageSummary.coveredPct ?? 0)}%</dd>
        <dt>Dead zones</dt><dd>${dz.length} zone${dz.length !== 1 ? 's' : ''} · ${fmtKm2(dz.reduce((s, z) => s + (z.areaKm2 ?? 0), 0))} total</dd>
        <dt>Weakest link</dt><dd>${coverageSummary.weakestDbm != null ? Math.round(coverageSummary.weakestDbm) + ' dBm' : '—'}</dd>
        <dt>Propagation model</dt><dd>${esc(modelInfo.label ?? '—')}${modelInfo.margin ? ' · ' + esc(modelInfo.margin) : ''}</dd>
      </dl>
    </section>`;
  }

  // ── CSS ────────────────────────────────────────────────────────────────────
  const css = `
    *, *::before, *::after { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 15mm; }
    body {
      font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 12mm 0 0;
    }
    h1 { font-size: 18pt; font-weight: 700; margin: 0 0 4pt; }
    h2 { font-size: 11pt; font-weight: 600; color: #0a5c5c; margin: 16pt 0 6pt; page-break-after: avoid; }
    section { margin-bottom: 12pt; }
    .brief-header { padding-bottom: 8pt; border-bottom: 1.5pt solid #0a5c5c; margin-bottom: 12pt; page-break-after: avoid; }
    .brief-meta { font-size: 9pt; color: #555; display: flex; gap: 16pt; margin-top: 4pt; }
    .brief-map img { max-width: 100%; max-height: 120mm; object-fit: contain; border: 0.5pt solid #ccc; }
    .brief-map--missing { background: #f5f5f5; padding: 8pt; color: #888; font-style: italic; }
    .brief-caption { font-size: 8.5pt; color: #666; margin: 3pt 0 0; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; page-break-inside: auto; }
    thead { background: #f0f7f7; }
    th { font-weight: 600; color: #0a5c5c; text-align: left; padding: 4pt 5pt; border: 0.5pt solid #ccc; }
    td { padding: 3pt 5pt; border: 0.5pt solid #ccc; }
    tr:nth-child(even) td { background: #fafafa; }
    .brief-bad { color: #c00; font-weight: 600; }
    dl { display: grid; grid-template-columns: 160pt 1fr; gap: 3pt 12pt; margin: 0; }
    dt { font-weight: 600; color: #444; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    .brief-note { font-size: 8.5pt; color: #888; margin-top: 4pt; }
    .brief-footer { margin-top: 20pt; padding-top: 6pt; border-top: 0.5pt solid #ccc; font-size: 8pt; color: #888; page-break-before: avoid; }
    .brief-opsec { margin-top: 4pt; color: #b35c00; font-style: italic; }
    @media print {
      body { padding: 0; }
      a { color: inherit; text-decoration: none; }
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mission Brief — ${esc(missionName)}</title>
  <style>${css}</style>
</head>
<body>
  <header class="brief-header">
    <h1>Mission Communications Brief</h1>
    <div class="brief-meta">
      <span>${esc(missionName)}</span>
      <span>${esc(dateStr)}</span>
      <span>Generated by GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''}</span>
    </div>
  </header>

  ${mapSection}
  ${paceSection}
  ${radioSection}
  ${linkSection}
  ${covSection}

  <footer class="brief-footer">
    <p>GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''} · ${esc(dateStr)}</p>
    <p class="brief-opsec">
      OPSEC: Verify classification before distributing this document.
      Coordinates originate from your local mission file — they are never stored
      or transmitted by GroundLink.${maskCoords ? ' Coordinates have been redacted in this copy.' : ''}
    </p>
  </footer>
</body>
</html>`;
}

/**
 * Open the brief HTML in a new tab (ready for Ctrl+P / print-to-PDF).
 * The blob URL is revoked after 90 s — long enough for the print dialog.
 * @param {string} html — complete HTML document string
 */
export function openBrief(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');
  if (!tab) {
    // Pop-up blocked: fall back to a data URI download
    const a = document.createElement('a');
    a.href = url;
    a.download = `groundlink-brief-${Date.now()}.html`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 90_000);
}
