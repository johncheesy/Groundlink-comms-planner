/**
 * M40 — Frequency plan export.
 *
 * Generates a per-node frequency plan table from the active radio arsenal
 * and PACE plan. Output: print-ready HTML (opens in new tab, Ctrl+P → PDF)
 * with a table: Node / Role / Radio / Band / Freq (MHz) / Power (W) /
 * Rx Sensitivity / PACE tier / Notes.
 *
 * No external dependencies. Same blob-URL pattern as brief.js (M37).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtFreq = (mhz) => mhz != null ? `${Number(mhz).toFixed(3)}` : '—';
const fmtPow  = (w)   => w   != null ? `${Number(w).toFixed(1)}` : '—';
const fmtSens = (dbm) => dbm != null ? `${Math.round(dbm)} dBm` : '—';

/** Map a radio role to a short human-readable node type */
function roleLabel(role) {
  const MAP = {
    handheld: 'Handheld',
    manpack:  'Manpack',
    mobile:   'Mobile',
    base:     'Base station',
    repeater: 'Repeater',
    manet:    'MANET node',
    lora:     'LoRa sensor',
    satcom:   'Satcom terminal',
    hf:       'HF station',
  };
  return MAP[role] ?? role ?? '—';
}

/** Find which PACE tier this band/radio appears in */
function paceTier(radio, paceLegs = []) {
  if (!paceLegs?.length) return '—';
  // Match by band label
  const band = bandFromFreq(radio.defaultFreqMHz ?? radio.freqRangeMHz?.[0]);
  const leg = paceLegs.find((l) => l.band === band);
  return leg?.tier ?? '—';
}

function bandFromFreq(mhz) {
  if (!mhz) return null;
  if (mhz < 30)    return 'HF';
  if (mhz < 300)   return 'VHF';
  if (mhz < 1000)  return 'UHF';
  if (mhz < 3000)  return 'L-band';
  return 'SHF+';
}

/**
 * Generate a printable HTML frequency plan.
 *
 * @param {object} opts
 * @param {Array}   opts.arsenal     — radios from radios.getArsenal()
 * @param {Array}   opts.paceLegs   — from buildPace().legs (optional)
 * @param {string}  opts.missionName
 * @param {string}  opts.buildVersion
 * @returns {string} complete HTML document
 */
export function generateFreqPlan({ arsenal = [], paceLegs = [], missionName = 'Mission', buildVersion = '' } = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  const rows = arsenal.map((r, i) => {
    const tier = paceTier(r, paceLegs);
    const band = bandFromFreq(r.defaultFreqMHz ?? r.freqRangeMHz?.[0]) ?? '—';
    const tierClass = tier === 'P' ? 'fp-tier-p' : tier === 'A' ? 'fp-tier-a' : tier === 'C' ? 'fp-tier-c' : tier === 'E' ? 'fp-tier-e' : '';
    return `<tr>
      <td>${esc(r.callsign ?? r.name ?? `Node ${i + 1}`)}</td>
      <td>${esc(roleLabel(r.role))}</td>
      <td>${esc(r.label ?? r.model ?? '—')}</td>
      <td>${esc(band)}</td>
      <td class="fp-freq">${esc(fmtFreq(r.defaultFreqMHz))}</td>
      <td class="fp-num">${esc(r.freqRangeMHz ? r.freqRangeMHz.join('–') : '—')}</td>
      <td class="fp-num">${esc(fmtPow(r.powerW))}</td>
      <td class="fp-num">${esc(fmtSens(r.rxSensDbm))}</td>
      <td class="${tierClass}">${esc(tier)}</td>
      <td class="fp-notes">${esc(r.notes ?? '')}</td>
    </tr>`;
  }).join('');

  const css = `
    *, *::before, *::after { box-sizing: border-box; }
    @page { size: A4 landscape; margin: 12mm; }
    body {
      font-family: 'Hanken Grotesk', system-ui, sans-serif;
      font-size: 9pt;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 10mm 0 0;
    }
    h1 { font-size: 14pt; font-weight: 700; margin: 0 0 2pt; }
    .hdr { border-bottom: 1.5pt solid #0a5c5c; padding-bottom: 6pt; margin-bottom: 10pt; }
    .meta { font-size: 8pt; color: #666; display: flex; gap: 16pt; margin-top: 3pt; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: #f0f7f7; }
    th { font-weight: 600; color: #0a5c5c; padding: 4pt 5pt; border: 0.5pt solid #ccc; text-align: left; white-space: nowrap; }
    td { padding: 3pt 5pt; border: 0.5pt solid #ccc; }
    tr:nth-child(even) td { background: #fafafa; }
    .fp-freq { font-family: 'Courier New', monospace; font-weight: 700; font-size: 10pt; }
    .fp-num  { font-variant-numeric: tabular-nums; text-align: right; }
    .fp-notes { font-size: 8pt; color: #555; }
    .fp-tier-p { background: color-mix(in srgb, #0a8475 12%, #fff); font-weight: 700; color: #0a5c5c; text-align: center; }
    .fp-tier-a { background: color-mix(in srgb, #2a7fe0 12%, #fff); font-weight: 600; color: #1a5faa; text-align: center; }
    .fp-tier-c { background: color-mix(in srgb, #cf8a16 12%, #fff); font-weight: 600; color: #8a5a0a; text-align: center; }
    .fp-tier-e { background: color-mix(in srgb, #dd4f68 12%, #fff); font-weight: 600; color: #9a1a30; text-align: center; }
    .footer { margin-top: 10pt; font-size: 7.5pt; color: #888; border-top: 0.5pt solid #ccc; padding-top: 4pt; }
    @media print { body { padding: 0; } }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Freq Plan — ${esc(missionName)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="hdr">
    <h1>Frequency Plan</h1>
    <div class="meta">
      <span>${esc(missionName)}</span>
      <span>${esc(dateStr)}</span>
      <span>${arsenal.length} radio${arsenal.length !== 1 ? 's' : ''}</span>
      <span>GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''}</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Callsign / Node</th>
        <th>Role</th>
        <th>Radio model</th>
        <th>Band</th>
        <th>Freq (MHz)</th>
        <th>Range (MHz)</th>
        <th>Power (W)</th>
        <th>Rx sens.</th>
        <th>PACE</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="10">No radios in arsenal — add radios first.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <p>PACE tiers: P = Primary · A = Alternate · C = Contingency · E = Emergency</p>
    <p>GroundLink${buildVersion ? ' · ' + esc(buildVersion) : ''} · ${esc(dateStr)} — Frequencies are indicative planning values. Verify against actual radio programming and local licensing.</p>
  </div>
</body>
</html>`;
}

/** Open the freq plan in a new tab (Ctrl+P → PDF). Same as openBrief() pattern. */
export function openFreqPlan(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const tab  = window.open(url, '_blank');
  if (!tab) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `groundlink-freq-plan-${Date.now()}.html`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 90_000);
}
