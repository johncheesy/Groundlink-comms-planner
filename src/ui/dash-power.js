/**
 * M21 §B — Power & endurance focus dashboard. Renders from the structured
 * model main.js stashes on every "Build power plan" run (M8 data, no new
 * computation here): four metric cards, a per-node endurance table with
 * capacity bars (coverage-spectrum tokens), and timings + ATAK side cards.
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtH = (h) => (Number.isFinite(h) ? (h >= 100 ? String(Math.round(h)) : h.toFixed(1)) : '∞');
const pct = (f) => Math.round((Number.isFinite(f) ? f : 0) * 100);

/** Bar colour from headroom: ≥2× mission green, ≥1× amber-free teal band, short rose. */
function barVar(ratio) {
  if (!Number.isFinite(ratio)) return 'var(--s1)';
  if (ratio >= 2) return 'var(--s1)';
  if (ratio >= 1) return 'var(--s2)';
  if (ratio >= 0.6) return 'var(--s3)';
  return 'var(--s5)';
}

function metricCard(label, value, unit, hint) {
  return (
    `<div class="powdash__metric">` +
    `<span class="powdash__metric-label">${esc(label)}</span>` +
    `<span class="powdash__metric-value" data-numeric>${esc(value)}<span class="powdash__metric-unit">${esc(unit)}</span></span>` +
    `<span class="powdash__metric-hint">${esc(hint)}</span>` +
    `</div>`
  );
}

export function createPowerDash({ getModel, buildPlan }) {
  let host = null;

  function render() {
    if (!host) return;
    const m = getModel();
    if (!m) {
      host.innerHTML =
        `<div class="powdash__empty">` +
        `<p class="help">No power plan yet — build one from the mission duration and comms tempo on the left.</p>` +
        `<button type="button" class="btn btn--primary powdash__build">Build power plan</button>` +
        `</div>`;
      return;
    }

    const batt = m.rows.filter((r) => r.supply === 'battery' && Number.isFinite(r.enduranceHours));
    const tightest = batt.length
      ? batt.reduce((a, b) => (b.enduranceHours < a.enduranceHours ? b : a))
      : null;
    const totalBatteries = batt.reduce((s, r) => s + (r.batteriesWithSpare || 0), 0);
    const solarW = m.rows.reduce((s, r) => s + (r.solarW || 0), 0);
    const networkH = tightest ? tightest.enduranceHours : Infinity;

    const cards =
      metricCard('Network endurance', fmtH(networkH), 'h', `mission ${m.missionHours} h`) +
      metricCard('Batteries to carry', String(totalBatteries), '', 'incl. spares') +
      metricCard('Solar budget', String(solarW), 'W', 'static sites') +
      metricCard('Tightest node', tightest ? tightest.name : '—', '', tightest ? `${fmtH(tightest.enduranceHours)} h on ${tightest.radio}` : 'no battery nodes');

    const bars = m.rows
      .map((r) => {
        if (r.supply !== 'battery') {
          const note =
            r.supply === 'vehicle' ? 'Vehicle-powered'
            : r.supply === 'none' ? 'No radio assigned'
            : `Solar/mains · ${r.solarW ?? '—'} W panel`;
          return (
            `<div class="powdash__row powdash__row--ext">` +
            `<span class="powdash__row-name">${esc(r.name)}</span>` +
            `<span class="powdash__row-radio">${esc(r.radio)}</span>` +
            `<span class="powdash__row-note">${esc(note)}</span>` +
            `</div>`
          );
        }
        const ratio = r.enduranceHours / m.missionHours;
        const width = Math.max(4, Math.min(100, ratio * 50)); // 2× mission = full bar
        return (
          `<div class="powdash__row">` +
          `<span class="powdash__row-name">${esc(r.name)}</span>` +
          `<span class="powdash__row-radio">${esc(r.radio)}</span>` +
          `<span class="powdash__bar"><span class="powdash__bar-fill" style="width:${width}%;background:${barVar(ratio)}"></span></span>` +
          `<span class="powdash__row-h" data-numeric>${fmtH(r.enduranceHours)} h · ${r.batteriesWithSpare} batt</span>` +
          `</div>`
        );
      })
      .join('');

    const duty = m.duty
      ? `<p class="powdash__side-body" data-numeric>TX ${pct(m.duty.tx)}% · RX ${pct(m.duty.rx)}% · standby ${pct(m.duty.standby)}%</p>` +
        `<p class="powdash__side-note">Over a ${m.missionHours} h mission.</p>`
      : '<p class="powdash__side-note">No timings plan.</p>';

    const atak = m.atak
      ? `<p class="powdash__side-body" data-numeric>${Math.round(m.atak.consumedMah)} mAh drawn @ ${m.atak.drawMa} mA</p>` +
        `<p class="powdash__side-note">Carry ${m.atak.bank.fullOffBankSizeMah} mAh × ${m.atak.bank.fullOffBankCount} powerbank${m.atak.bank.fullOffBankCount === 1 ? '' : 's'} (65% usable).</p>`
      : '<p class="powdash__side-note">No ATAK estimate.</p>';

    host.innerHTML =
      `<div class="powdash__metrics">${cards}</div>` +
      `<div class="powdash__main">` +
      `<div class="powdash__nodes"><h3 class="powdash__h">Per-node endurance</h3>${bars}</div>` +
      `<div class="powdash__side">` +
      `<div class="powdash__card"><h3 class="powdash__h">Timings plan</h3>${duty}</div>` +
      `<div class="powdash__card"><h3 class="powdash__h">ATAK / powerbank</h3>${atak}</div>` +
      `</div></div>`;
  }

  function handleClick(e) {
    if (e.target.closest('.powdash__build')) {
      buildPlan?.();
      render();
    }
  }

  return {
    replace: false, // the M8 form (inputs) stays alongside the dashboard
    mount(el) {
      host = el;
      host.classList.add('powdash');
      host.addEventListener('click', handleClick);
      render();
    },
    unmount() {
      host = null;
    },
    refresh: render,
  };
}
