/**
 * Path profile chart (M14) — renders a terrain cross-section with the first
 * Fresnel zone and a compact link-budget table as inline SVG. No physics here;
 * everything it needs is precomputed in the `data` object (see profile-tool.js).
 *
 * The Fresnel boundaries are reconstructed from the LOS ray and the per-sample
 * clearance, so the chart never has to re-run the radius maths:
 *   lower = ground + clearance           ( = LOS − 0.6·r1 )
 *   upper = 2·LOS − ground − clearance   ( = LOS + 0.6·r1 )
 */

const VIEW_W = 600;
const VIEW_H = 220;
const M = { top: 12, right: 14, bottom: 26, left: 46 }; // plot margins (px)
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;

const fmtKm = (km) => (km >= 10 ? km.toFixed(0) : km.toFixed(1));
const fmtDb = (db) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;

/**
 * @param {HTMLElement} container
 * @param {Object} data { distances, elevations, clearances, txElev, rxElev,
 *                        distanceKm, distanceM, minClearance, minClearanceIdx,
 *                        obstructed, budget }
 */
export function renderProfileChart(container, data) {
  const { distances, elevations, clearances, txElev, rxElev, distanceKm, obstructed } = data;
  const distanceM = data.distanceM ?? distanceKm * 1000;
  const n = elevations.length;
  const losAt = (d) => txElev + ((rxElev - txElev) * d) / (distanceM || 1);

  // Reconstruct Fresnel boundaries (see header note).
  const lower = new Array(n);
  const upper = new Array(n);
  for (let i = 0; i < n; i++) {
    const los = losAt(distances[i]);
    lower[i] = elevations[i] + clearances[i];
    upper[i] = 2 * los - elevations[i] - clearances[i];
  }

  // Vertical extent: terrain, both Fresnel envelopes and the antenna tips.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    yMin = Math.min(yMin, elevations[i], lower[i]);
    yMax = Math.max(yMax, elevations[i], upper[i]);
  }
  yMin = Math.min(yMin, txElev, rxElev);
  yMax = Math.max(yMax, txElev, rxElev);
  const pad = Math.max((yMax - yMin) * 0.08, 5);
  yMin -= pad;
  yMax += pad;

  const sx = (d) => M.left + (distanceM ? (d / distanceM) * PLOT_W : 0);
  const sy = (e) => M.top + (1 - (e - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const pts = (arr) => arr.map((e, i) => `${sx(distances[i]).toFixed(1)},${sy(e).toFixed(1)}`).join(' ');

  // Ground polygon: terrain line closed down to the plot floor.
  const floorY = (M.top + PLOT_H).toFixed(1);
  const groundPoly =
    `${sx(0).toFixed(1)},${floorY} ` + pts(elevations) + ` ${sx(distanceM).toFixed(1)},${floorY}`;

  // Axis ticks: X every ~1/5 of the span, Y at 4 evenly spaced levels.
  const xTicks = [];
  for (let i = 0; i <= 5; i++) {
    const d = (distanceM * i) / 5;
    xTicks.push(
      `<line class="profile-chart__grid" x1="${sx(d).toFixed(1)}" y1="${M.top}" x2="${sx(d).toFixed(1)}" y2="${M.top + PLOT_H}" />` +
      `<text class="profile-chart__tick" x="${sx(d).toFixed(1)}" y="${VIEW_H - 8}" text-anchor="middle">${fmtKm((distanceKm * i) / 5)}</text>`,
    );
  }
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const e = yMin + ((yMax - yMin) * i) / 4;
    yTicks.push(
      `<line class="profile-chart__grid" x1="${M.left}" y1="${sy(e).toFixed(1)}" x2="${M.left + PLOT_W}" y2="${sy(e).toFixed(1)}" />` +
      `<text class="profile-chart__tick" x="${M.left - 6}" y="${(sy(e) + 3).toFixed(1)}" text-anchor="end">${Math.round(e)}</text>`,
    );
  }

  const fresnelClass = obstructed ? 'profile-chart__fresnel--blocked' : 'profile-chart__fresnel--clear';

  // Obstruction marker at the worst clearance point.
  let obstructionMark = '';
  if (obstructed) {
    const idx = data.minClearanceIdx ?? clearances.indexOf(Math.min(...clearances));
    const mx = sx(distances[idx]);
    const my = sy(elevations[idx]);
    obstructionMark =
      `<circle class="profile-chart__obstruction" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4" />` +
      `<text class="profile-chart__obstruction-label" x="${mx.toFixed(1)}" y="${(my - 8).toFixed(1)}" text-anchor="middle">obstruction</text>`;
  }

  const txY = sy(txElev);
  const rxY = sy(rxElev);
  const x0 = sx(0);
  const xN = sx(distanceM);

  const svg =
    `<svg class="profile-chart__svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" role="img" aria-label="Terrain path profile">` +
    yTicks.join('') +
    xTicks.join('') +
    // Ground fill
    `<polygon class="profile-chart__ground" points="${groundPoly}" />` +
    // Fresnel zone boundaries (± 60% of r1)
    `<polyline class="profile-chart__fresnel ${fresnelClass}" points="${pts(upper)}" />` +
    `<polyline class="profile-chart__fresnel ${fresnelClass}" points="${pts(lower)}" />` +
    // Line of sight (TX tip → RX tip)
    `<line class="profile-chart__los" x1="${x0.toFixed(1)}" y1="${txY.toFixed(1)}" x2="${xN.toFixed(1)}" y2="${rxY.toFixed(1)}" />` +
    obstructionMark +
    // Endpoint markers + labels
    `<circle class="profile-chart__node" cx="${x0.toFixed(1)}" cy="${txY.toFixed(1)}" r="3.5" />` +
    `<circle class="profile-chart__node" cx="${xN.toFixed(1)}" cy="${rxY.toFixed(1)}" r="3.5" />` +
    `<text class="profile-chart__end" x="${(x0 + 4).toFixed(1)}" y="${(txY - 6).toFixed(1)}" text-anchor="start">TX</text>` +
    `<text class="profile-chart__end" x="${(xN - 4).toFixed(1)}" y="${(rxY - 6).toFixed(1)}" text-anchor="end">RX</text>` +
    `</svg>`;

  container.innerHTML = svg + budgetTable(data);
}

/** Compact link-budget table beneath the chart. */
function budgetTable(data) {
  const b = data.budget || {};
  const status = b.viable && !data.obstructed
    ? '<span class="profile-budget__status profile-budget__status--ok">✓ viable</span>'
    : `<span class="profile-budget__status profile-budget__status--bad">✗ ${data.obstructed ? 'obstructed' : 'no margin'}</span>`;
  const rows = [
    ['FSPL', fmtDb(b.fsplDb ?? 0)],
    ['Diffraction loss', fmtDb(b.diffractionDb ?? 0)],
    ['EIRP', `${(b.eirpDbm ?? 0).toFixed(1)} dBm`],
    ['Received signal', `${(b.rxSignalDbm ?? 0).toFixed(1)} dBm`],
    ['Link margin', fmtDb(b.marginDb ?? 0)],
    ['Status', status],
  ];
  return (
    `<table class="profile-budget-table"><tbody>` +
    rows
      .map(([k, v]) => `<tr><th scope="row">${k}</th><td data-numeric>${v}</td></tr>`)
      .join('') +
    `</tbody></table>`
  );
}
