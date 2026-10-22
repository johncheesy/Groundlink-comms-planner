/**
 * M36 — Mission Ops Dashboard (right-rail flyout).
 * M47 — Mission readiness score (gauge + dim breakdown).
 *
 * Fuses five live data streams into one panel: RF coverage, cellular
 * best-network, drone relay, PACE plan completeness, and teams / Erlang.
 * M47 adds a 0–100 readiness gauge at the top.
 * Read-only — all edits happen via the normal left-panel sections.
 *
 * Usage:
 *   const dash = createOpsDashboard(hostEl, { onRunCoverage, onOpenPace, onOpenTeams });
 *   dash.update(snapshot);  // call after any relevant state change
 *   dash.show() / dash.hide();
 *
 * snapshot shape:
 *   {
 *     coverage:      object | null,   // summarizeCoverage() output
 *     coverageStale: boolean,
 *     cellular:      object | null,   // cellularController.state()
 *     drone:         object | null,   // droneController.state()
 *     pace:          object | null,   // buildPace() output
 *     teams:         object | null,   // teamsManager.summary()
 *     erlang:        object | null,   // erlangResult
 *     readiness:     object | null,   // M47: { score, tier, dims } from computeReadiness()
 *   }
 */

import { READINESS_DIMS, MIN_ASSESSED } from '../analysis/readiness.js';

const e = (tag, cls, ...children) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtDbm = (v) => (v == null ? '—' : `${Math.round(v)} dBm`);

function pill(text, mod = 'teal') {
  const s = document.createElement('span');
  s.className = `dash-ops__pill dash-ops__pill--${mod}`;
  s.textContent = text;
  return s;
}

function row(label, value, hint) {
  const r = e('div', 'dash-ops__row');
  const l = e('span', 'dash-ops__row-label', label);
  const v = e('span', 'dash-ops__row-value');
  v.textContent = value ?? '—';
  if (hint) v.title = hint;
  r.append(l, v);
  return r;
}

function section(title, pillEl, ...rows) {
  const wrap = e('div', 'dash-ops__section');
  const hd = e('div', 'dash-ops__section-head');
  const t = e('span', 'dash-ops__section-title', title);
  hd.append(t);
  if (pillEl) hd.append(pillEl);
  wrap.append(hd);
  for (const r of rows) if (r) wrap.append(r);
  return wrap;
}

// ── M47: Readiness gauge ───────────────────────────────────────────────────

/**
 * Build an SVG arc gauge for the readiness score.
 * Arc goes from 210° to −30° (240° sweep). Score 0→100 fills the arc.
 */
function buildReadinessGauge(score, tier) {
  const W = 96, H = 72, CX = 48, CY = 60, R = 36;
  const START_DEG = 210, END_DEG = -30; // CCW 240° sweep
  const sweep = 240;
  const deg = START_DEG - (score / 100) * sweep;

  function pt(d) {
    const r = (d * Math.PI) / 180;
    return { x: CX + R * Math.cos(r), y: CY - R * Math.sin(r) };
  }

  const s = pt(START_DEG);
  const fillEnd = pt(deg);
  const largeArc = (score / 100) * sweep > 180 ? 1 : 0;

  const trackColor = 'var(--hair)';
  const fillColor  = tier === 'high' ? 'var(--accent)' : tier === 'mid' ? 'var(--warn)' : 'var(--bad)';

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('class', 'readiness-gauge');
  svg.setAttribute('aria-hidden', 'true');

  // Track arc (grey, full 240°)
  const trackEnd = pt(END_DEG);
  const trackPath = document.createElementNS(ns, 'path');
  trackPath.setAttribute('d',
    `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} ` +
    `A ${R} ${R} 0 1 0 ${trackEnd.x.toFixed(1)} ${trackEnd.y.toFixed(1)}`);
  trackPath.setAttribute('fill', 'none');
  trackPath.setAttribute('stroke', trackColor);
  trackPath.setAttribute('stroke-width', '5');
  trackPath.setAttribute('stroke-linecap', 'round');
  svg.appendChild(trackPath);

  // Filled arc (score)
  if (score > 0) {
    const fillPath = document.createElementNS(ns, 'path');
    fillPath.setAttribute('d',
      `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} ` +
      `A ${R} ${R} 0 ${largeArc} 0 ${fillEnd.x.toFixed(1)} ${fillEnd.y.toFixed(1)}`);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke', fillColor);
    fillPath.setAttribute('stroke-width', '5');
    fillPath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(fillPath);
  }

  // Score number
  const num = document.createElementNS(ns, 'text');
  num.setAttribute('x', CX);
  num.setAttribute('y', CY - 4);
  num.setAttribute('text-anchor', 'middle');
  num.setAttribute('class', 'readiness-num');
  num.textContent = score;
  svg.appendChild(num);

  // "/ 100" sub-label
  const sub = document.createElementNS(ns, 'text');
  sub.setAttribute('x', CX);
  sub.setAttribute('y', CY + 10);
  sub.setAttribute('text-anchor', 'middle');
  sub.setAttribute('class', 'readiness-sub');
  sub.textContent = '/ 100';
  svg.appendChild(sub);

  return svg;
}

function renderReadiness(readiness) {
  if (!readiness) return null;
  const { score, tier, dims, assessed = 0, total = READINESS_DIMS.length } = readiness;
  const pending = score == null;

  const wrap = e('div', `readiness-section ${pending ? 'intel-score--pending' : `intel-score--${tier}`}`);
  const head = e('div', 'dash-ops__section-head');
  head.append(e('span', 'dash-ops__section-title', 'Mission readiness'));

  if (pending) {
    head.append(pill('Not scored yet', 'amber'));
  } else {
    const tierLabel = tier === 'high' ? 'Ready' : tier === 'mid' ? 'Partial' : 'Not ready';
    const pillMod   = tier === 'high' ? 'teal'  : tier === 'mid' ? 'amber'  : 'bad';
    head.append(pill(tierLabel, pillMod));
  }
  wrap.append(head);

  // Say how much of the picture the number rests on.
  wrap.append(e('p', 'readiness-basis', pending
    ? `${assessed} of ${total} checks done. A score needs at least ${MIN_ASSESSED}: run coverage, build the comms plan, and check frequencies.`
    : `Based on ${assessed} of ${total} checks. Unchecked items are left out of the score, not counted as passed.`));

  // Gauge + dims side-by-side
  const body = e('div', 'readiness-body');

  if (!pending) body.append(buildReadinessGauge(score, tier));

  const dims_el = e('div', 'readiness-dims');
  for (const d of READINESS_DIMS) {
    const val = dims?.[d.key];
    const bar = e('div', 'readiness-dim');
    const label = e('span', 'readiness-dim__label', d.label);
    const valSpan = e('span', 'readiness-dim__val');
    if (val == null) {
      valSpan.textContent = '—';
      valSpan.className = 'readiness-dim__val readiness-dim__val--na';
    } else {
      valSpan.textContent = `${val}%`;
      valSpan.className = `readiness-dim__val readiness-dim__val--${val >= 75 ? 'ok' : val >= 40 ? 'warn' : 'bad'}`;
    }
    // Mini bar
    const miniBar = e('div', 'readiness-dim__bar');
    if (val != null) {
      const fill = e('div', 'readiness-dim__fill');
      fill.style.width = `${val}%`;
      fill.style.background = val >= 75 ? 'var(--accent)' : val >= 40 ? 'var(--warn)' : 'var(--bad)';
      miniBar.append(fill);
    }
    bar.append(label, miniBar, valSpan);
    dims_el.append(bar);
  }
  body.append(dims_el);
  wrap.append(body);

  return wrap;
}

function placeholder(text, btnLabel, onClick) {
  const p = e('div', 'dash-ops__placeholder', text);
  if (btnLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--sm';
    b.textContent = btnLabel;
    b.addEventListener('click', onClick);
    p.append(' ', b);
  }
  return p;
}

export function createOpsDashboard(host, { onRunCoverage, onOpenPace, onOpenTeams } = {}) {
  let snap = {};

  function render() {
    host.innerHTML = '';

    // 0 ── M47: Mission readiness gauge ────────────────────────────────────
    const readEl = renderReadiness(snap.readiness);
    if (readEl) host.append(readEl);

    // 1 ── RF Coverage ─────────────────────────────────────────────────────
    const cov = snap.coverage;
    if (cov) {
      const pct = Math.round(cov.coveredPct ?? 0);
      const staleMod = snap.coverageStale ? 'amber' : 'teal';
      const staleLabel = snap.coverageStale ? 'stale' : `${pct}% covered`;
      host.append(section(
        'RF Coverage',
        pill(staleLabel, staleMod),
        row('Dead zones', `${cov.deadZones?.length ?? 0}${cov.deadZones?.length ? ` (${(cov.deadZones.reduce((s, z) => s + (z.areaKm2 ?? 0), 0)).toFixed(1)} km²)` : ''}`),
        row('Weakest link', fmtDbm(cov.weakestDbm)),
      ));
    } else {
      const ph = placeholder('No coverage result yet.', 'Run coverage', () => onRunCoverage?.());
      host.append(section('RF Coverage', pill('not run', 'dim'), ph));
    }

    // 2 ── Cellular ────────────────────────────────────────────────────────
    const cell = snap.cellular;
    if (cell && cell.active) {
      const best = cell.bestNetwork;
      host.append(section(
        'Cellular',
        pill(best ? best.label : 'scanning…', 'azure'),
        row('Towers in AOI', cell.towerCount != null ? String(cell.towerCount) : '—'),
        row('Strongest', fmtDbm(cell.strongestDbm)),
        cell.fallback ? row('Fallback', cell.fallback.label) : null,
      ));
    } else {
      host.append(section('Cellular', pill('layer off', 'dim'),
        placeholder('Enable the cellular layer to see coverage.')));
    }

    // 3 ── Drone Relay ─────────────────────────────────────────────────────
    const drone = snap.drone;
    if (drone && drone.hasDrone) {
      const gainText = drone.result
        ? `+${Math.round(drone.result.gainPts ?? 0)} pts vs ground`
        : null;
      host.append(section(
        'Drone Relay',
        pill(drone.computing ? 'computing…' : 'active', 'teal'),
        drone.altM ? row('Altitude', `${drone.altM} m AGL`) : null,
        drone.result ? row('Coverage', fmtPct(drone.result.altFrac)) : null,
        gainText ? row('Gain', gainText) : null,
      ));
    } else {
      host.append(section('Drone Relay', pill('not placed', 'dim'),
        placeholder('Place a drone relay on the map.')));
    }

    // 4 ── PACE Plan ───────────────────────────────────────────────────────
    const pace = snap.pace;
    if (pace && pace.legs) {
      const filled = pace.legs.filter((l) => l.primary || l.assets?.length).length;
      const total = pace.legs.length;
      const ok = filled >= total;
      host.append(section(
        'PACE Plan',
        pill(`${filled}/${total} tiers`, ok ? 'teal' : 'amber'),
        ...pace.legs.map((l) =>
          row(l.tier?.[0] ?? '?', l.primary ?? '—', l.tier),
        ),
      ));
      if (pace.gaps?.length) {
        const gapEl = e('div', 'dash-ops__gaps');
        pace.gaps.forEach((g) => {
          const g2 = e('div', 'dash-ops__gap');
          g2.textContent = `⚠ ${g}`;
          gapEl.append(g2);
        });
        host.querySelector('.dash-ops__section:last-child')?.append(gapEl);
      }
    } else {
      const ph = placeholder('No PACE plan yet.', 'Build plan', () => onOpenPace?.());
      host.append(section('PACE Plan', pill('not built', 'dim'), ph));
    }

    // 5 ── Teams & Erlang ──────────────────────────────────────────────────
    const teams = snap.teams;
    const erlang = snap.erlang;
    if (teams && (teams.teamCount > 0 || teams.operatorCount > 0)) {
      const erl = erlang?.totalErlang;
      const gos = erlang?.gradeOfService;
      host.append(section(
        'Teams',
        pill(`${teams.teamCount ?? 0} teams · ${teams.operatorCount ?? 0} users`, 'azure'),
        erl != null ? row('Peak traffic', `${erl.toFixed(2)} Erl`) : null,
        gos != null ? row('Grade of service', `B.${String(Math.round(gos * 100)).padStart(2, '0')}`) : null,
        erlang?.channelsNeeded ? row('Channels needed', String(erlang.channelsNeeded)) : null,
      ));
    } else {
      const ph = placeholder('No teams configured.', 'Open teams', () => onOpenTeams?.());
      host.append(section('Teams', pill('none', 'dim'), ph));
    }
  }

  return {
    update(snapshot) {
      snap = { ...snap, ...snapshot };
      if (!host.hidden) render();
    },
    show() {
      host.hidden = false;
      render();
    },
    hide() {
      host.hidden = true;
    },
  };
}
