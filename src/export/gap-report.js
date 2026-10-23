/**
 * M43 — Coverage gap report.
 *
 * Generates a print-ready HTML document listing dead zones with centroid
 * coordinates, estimated area and radius, and a relay recommendation for
 * each zone. Opens in a new tab (Ctrl+P → PDF), same pattern as brief.js.
 *
 * Dead zones come from summarizeCoverage() → { deadZones, coveredPct, … }.
 * Each zone has: { centroid: {lng, lat}, areaKm2, cells }.
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

const fmtCoord = (v, d = 5) => (typeof v === 'number' ? v.toFixed(d) : '—');
const fmtArea  = (km2) => (km2 >= 100 ? km2.toFixed(0) : km2 >= 10 ? km2.toFixed(1) : km2.toFixed(2));

/** Estimate the effective radius of a zone from its area, assuming circular shape. */
const estimateRadiusKm = (areaKm2) => Math.sqrt(areaKm2 / Math.PI);

/** Return a plain-text relay recommendation based on zone size. */
export function relayRecommendation(areaKm2) {
  if (areaKm2 < 0.5) return 'Minor gap — mast height increase or antenna reorientation may suffice.';
  if (areaKm2 < 5)   return 'Small gap — consider a single passive repeater or raised mast.';
  if (areaKm2 < 25)  return 'Medium gap — deploy a static relay or tethered drone relay.';
  return 'Large gap — airborne relay (drone / aerostat) or dedicated repeater site recommended.';
}

/**
 * Generate a printable HTML gap report.
 *
 * @param {object} opts
 * @param {Array}    opts.deadZones       — from summarizeCoverage().deadZones
 * @param {object}   [opts.coverageSummary] — full summarizeCoverage() result
 * @param {string}   [opts.missionName]
 * @param {string}   [opts.modelLabel]    — propagation model label
 * @param {string}   [opts.buildVersion]
 * @returns {string} complete HTML document
 */
export function generateGapReport({
  deadZones = [],
  coverageSummary = null,
  missionName = 'Mission',
  modelLabel = 'unknown',
  buildVersion = '',
} = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const covPct = coverageSummary?.coveredPct != null ? `${Math.round(coverageSummary.coveredPct)}%` : '—';
  const totalDeadArea = deadZones.reduce((s, z) => s + (z.areaKm2 ?? 0), 0);

  const rows = deadZones.length
    ? deadZones
        .map(
          (z, i) => `<tr>
    <td class="gap-id">${i + 1}</td>
    <td class="gap-coord">${fmtCoord(z.centroid?.lat)}, ${fmtCoord(z.centroid?.lng)}</td>
    <td class="gap-num">${fmtArea(z.areaKm2 ?? 0)}</td>
    <td class="gap-num">${estimateRadiusKm(z.areaKm2 ?? 0).toFixed(2)}</td>
    <td class="gap-rec">${esc(relayRecommendation(z.areaKm2 ?? 0))}</td>
  </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="gap-empty">No dead zones detected — coverage is complete within the AOI.</td></tr>`;

  const css = `
    *, *::before, *::after { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 14mm; }
    body {
      font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 10mm 0 0;
    }
    h1 { font-size: 16pt; font-weight: 700; margin: 0 0 3pt; }
    h2 { font-size: 11pt; font-weight: 600; color: #0a5c5c; margin: 14pt 0 5pt; page-break-after: avoid; }
    .hdr { border-bottom: 1.5pt solid #0a5c5c; padding-bottom: 6pt; margin-bottom: 12pt; }
    .meta { font-size: 9pt; color: #666; display: flex; gap: 16pt; flex-wrap: wrap; margin-top: 4pt; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin-bottom: 14pt; }
    .stat { background: #f0f7f7; border-radius: 6pt; padding: 8pt 10pt; }
    .stat__num { font-size: 18pt; font-weight: 700; font-variant-numeric: tabular-nums; color: #0a5c5c; }
    .stat__cap { font-size: 8.5pt; color: #555; display: block; margin-top: 1pt; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; page-break-inside: auto; }
    thead { background: #f0f7f7; }
    th { font-weight: 600; color: #0a5c5c; text-align: left; padding: 5pt 6pt; border: 0.5pt solid #ccc; white-space: nowrap; }
    td { padding: 4pt 6pt; border: 0.5pt solid #ccc; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .gap-id    { font-weight: 700; text-align: center; width: 28pt; color: #0a5c5c; }
    .gap-coord { font-family: 'Courier New', monospace; font-size: 8.5pt; white-space: nowrap; }
    .gap-num   { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .gap-rec   { font-size: 8.5pt; color: #444; }
    .gap-empty { text-align: center; padding: 14pt; color: #888; font-style: italic; }
    .note { font-size: 8.5pt; color: #888; margin-top: 6pt; }
    .footer { margin-top: 20pt; padding-top: 5pt; border-top: 0.5pt solid #ccc; font-size: 8pt; color: #888; }
    .opsec { margin-top: 3pt; color: #b35c00; font-style: italic; }
    @media print { body { padding: 0; } }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coverage Gap Report — ${esc(missionName)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="hdr">
    <h1>Coverage Gap Report</h1>
    <div class="meta">
      <span>${esc(missionName)}</span>
      <span>${esc(dateStr)}</span>
      <span>Model: ${esc(modelLabel)}</span>
      <span>GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''}</span>
    </div>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat__num">${esc(covPct)}</div>
      <span class="stat__cap">Coverage</span>
    </div>
    <div class="stat">
      <div class="stat__num">${deadZones.length}</div>
      <span class="stat__cap">Dead zone${deadZones.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="stat">
      <div class="stat__num">${fmtArea(totalDeadArea)} km²</div>
      <span class="stat__cap">Total uncovered area</span>
    </div>
  </div>

  <h2>Dead zones</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Centroid (lat, lng)</th>
        <th>Area (km²)</th>
        <th>Est. radius (km)</th>
        <th>Recommendation</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">
    Dead zones are 8-connected regions of cells with signal below the marginal threshold
    (class ≥ 3) inside the AOI. Up to 5 largest zones are reported.
    Centroid coordinates are the area-weighted centre of each zone.
  </p>

  <footer class="footer">
    <p>GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''} · ${esc(dateStr)}</p>
    <p class="opsec">
      OPSEC: Coordinates originate from your local mission file.
      They are never stored or transmitted by GroundLink. Verify classification before distributing.
    </p>
  </footer>
</body>
</html>`;
}

/**
 * Open the gap report in a new browser tab (ready for Ctrl+P / print-to-PDF).
 * Blob URL is revoked after 90 s.
 */
export function openGapReport(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');
  if (!tab) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `groundlink-gap-report-${Date.now()}.html`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 90_000);
}
