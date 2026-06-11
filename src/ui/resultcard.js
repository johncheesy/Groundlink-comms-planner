/**
 * M20 §3 — result summary card + stale-plan pill (DOM controllers).
 *
 * Card: floats bottom-centre over the map after an analysis run; shows
 * % covered / dead zones / weakest link from summarizeCoverage(), dead-zone
 * rows fly to their centroid, plus Relay advice + Report actions. Dismiss (×)
 * hides it until the next run; it also hides as soon as the plan goes stale
 * (the figures no longer describe the map).
 *
 * Pill: makes M19's silent debounced recompute visible — cause, "Recompute
 * now", a per-second countdown (5 s), and × to cancel the auto-run (the plan
 * stays stale; the §2 badge dot remains). Both are aria-live="polite".
 */

const fmtKm2 = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function createResultCard(host, { onZoneClick, onRelayAdvice, onReport } = {}) {
  const el = document.createElement('div');
  el.className = 'result-card';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Analysis summary');
  el.hidden = true;
  host.appendChild(el);

  let zones = [];

  el.addEventListener('click', (e) => {
    const zoneBtn = e.target.closest('[data-zone]');
    if (zoneBtn) {
      const z = zones[Number(zoneBtn.dataset.zone)];
      if (z) onZoneClick?.(z);
      return;
    }
    if (e.target.closest('[data-act="close"]')) el.hidden = true;
    else if (e.target.closest('[data-act="relay"]')) onRelayAdvice?.();
    else if (e.target.closest('[data-act="report"]')) onReport?.();
  });

  /** Render + show for a fresh summarizeCoverage() result. */
  function show(summary) {
    zones = summary.deadZones;
    const weakest = `${summary.weakestBelow ? '< ' : '≥ '}${Math.round(summary.weakestDbm)} dBm`;
    const zoneRows = zones
      .map(
        (z, i) =>
          `<li><button type="button" class="result-card__zone" data-zone="${i}">` +
          `<span>Zone ${i + 1}</span><span data-numeric>${fmtKm2(z.areaKm2)} km²</span></button></li>`,
      )
      .join('');
    el.innerHTML =
      `<button type="button" class="result-card__close" data-act="close" aria-label="Dismiss summary">×</button>` +
      `<div class="result-card__figures">` +
      `<div class="result-card__fig"><span class="result-card__num" data-numeric>${Math.round(summary.coveredPct)}%</span><span class="result-card__cap">covered</span></div>` +
      `<div class="result-card__fig"><span class="result-card__num" data-numeric>${zones.length}</span><span class="result-card__cap">dead zone${zones.length === 1 ? '' : 's'}</span></div>` +
      `<div class="result-card__fig"><span class="result-card__num" data-numeric>${weakest}</span><span class="result-card__cap">weakest link</span></div>` +
      `</div>` +
      (zoneRows ? `<ol class="result-card__zones">${zoneRows}</ol>` : '') +
      `<div class="result-card__actions">` +
      `<button type="button" class="btn btn--sm" data-act="relay">Relay advice</button>` +
      `<button type="button" class="btn btn--sm" data-act="report">Report</button>` +
      `</div>`;
    el.hidden = false;
  }

  return {
    show,
    hide() {
      el.hidden = true;
    },
  };
}

export function createStalePill(host, { seconds = 5, onRecompute, onCancel } = {}) {
  const el = document.createElement('div');
  el.className = 'stale-pill';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  el.innerHTML =
    `<span class="stale-pill__dot" aria-hidden="true"></span>` +
    `<span class="stale-pill__cause"></span>` +
    `<button type="button" class="stale-pill__run">Recompute now</button>` +
    `<span class="stale-pill__count" data-numeric></span>` +
    `<button type="button" class="stale-pill__close" aria-label="Cancel auto-recompute">×</button>`;
  host.appendChild(el);

  const causeEl = el.querySelector('.stale-pill__cause');
  const countEl = el.querySelector('.stale-pill__count');
  let timer = 0;
  let left = 0;

  function stop() {
    window.clearInterval(timer);
    timer = 0;
    el.hidden = true;
  }

  function fire() {
    stop();
    onRecompute?.();
  }

  el.querySelector('.stale-pill__run').addEventListener('click', fire);
  el.querySelector('.stale-pill__close').addEventListener('click', () => {
    stop();
    onCancel?.();
  });

  return {
    /** Show (or re-show) the pill and restart the countdown. */
    arm(cause) {
      window.clearInterval(timer);
      left = seconds;
      causeEl.textContent = cause;
      countEl.textContent = `auto in ${left} s`;
      el.hidden = false;
      timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) fire();
        else countEl.textContent = `auto in ${left} s`;
      }, 1000);
    },
    /** Hide without firing (a manual run superseded the countdown). */
    disarm: stop,
    isArmed: () => timer !== 0,
  };
}
