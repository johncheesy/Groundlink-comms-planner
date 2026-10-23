/**
 * M52 phase 2 — the status rail: five tiles that read existing state
 * (coverage, readiness, weakest link, dead zones, PACE) and an events list.
 * Nothing here computes a result; tileModel() only decides what each tile
 * says and in which tone, and it says "—" with a reason rather than a 0 or
 * a 100 when there is nothing to show (product review F2).
 *
 * Pure helpers first (unit-tested, DOM-free); createOpsRail() wires the DOM.
 */

import { LINK_FADE_MARGIN_DB } from '../analysis/path-profile.js';
import { legFilled } from '../pace/pace.js';

export const MAX_EVENTS = 8;

const fmtKm2 = (v) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));
const fmtDb = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} dB`;

/**
 * The five tiles from a snapshot of existing state. Pure.
 * @param {object} s
 * @param {object|null} s.coverage     summarizeCoverage() output
 * @param {boolean} [s.coverageStale]
 * @param {string|null} [s.modelLabel]  e.g. "P.1812 · ±6 dB"
 * @param {number|null} [s.cellM]
 * @param {object|null} s.readiness    computeReadiness() output
 * @param {object|null} s.pace         buildPace() output
 * @param {Array<{name:string, marginDb:number, status:'ok'|'warn'|'bad'}>} [s.links]
 *   checked radio links (M50); unchecked ones are left out
 * @param {number} [s.linkCount]       radio links in the mission, checked or not
 * @returns {Array<{key, label, value, sub, tone:'ok'|'warn'|'bad'|'none', boxes?}>}
 */
export function tileModel(s = {}) {
  const cov = s.coverage ?? null;
  const tiles = [];

  // 1 · Coverage
  if (cov && Number.isFinite(cov.coveredPct)) {
    const sub = [s.modelLabel, s.cellM ? `${Math.round(s.cellM)} m cells` : null].filter(Boolean).join(' · ');
    tiles.push({
      key: 'coverage', label: 'Coverage', value: `${Math.round(cov.coveredPct)} %`,
      sub: s.coverageStale ? `stale — ${sub || 'recompute'}` : sub || 'covered',
      tone: s.coverageStale ? 'warn' : 'ok',
    });
  } else {
    tiles.push({ key: 'coverage', label: 'Coverage', value: '—', sub: 'no run yet', tone: 'none' });
  }

  // 2 · Readiness — grey until there is a coverage run and a PACE plan
  const r = s.readiness ?? null;
  const analysed = Boolean(cov) && Boolean(s.pace?.legs?.length);
  if (!analysed) {
    tiles.push({ key: 'readiness', label: 'Readiness', value: '—', sub: !cov ? 'not analysed — run coverage' : 'not analysed — build the PACE plan', tone: 'none' });
  } else if (r?.score == null) {
    tiles.push({ key: 'readiness', label: 'Readiness', value: '—', sub: `${r?.assessed ?? 0} of ${r?.total ?? 6} checks — more needed`, tone: 'none' });
  } else {
    const tone = r.tier === 'high' ? 'ok' : r.tier === 'mid' ? 'warn' : 'bad';
    tiles.push({ key: 'readiness', label: 'Readiness', value: String(r.score), sub: `${r.assessed} of ${r.total} checks`, tone, dims: r.dims ?? null });
  }

  // 3 · Weakest link
  const links = (s.links ?? []).filter((l) => Number.isFinite(l.marginDb));
  if (links.length) {
    const w = links.reduce((a, b) => (b.marginDb < a.marginDb ? b : a));
    const tone = w.marginDb < 0 ? 'bad' : w.marginDb < LINK_FADE_MARGIN_DB || w.status === 'warn' ? 'warn' : 'ok';
    tiles.push({ key: 'link', label: 'Weakest link', value: fmtDb(w.marginDb), sub: w.name, tone });
  } else if (s.linkCount > 0) {
    tiles.push({ key: 'link', label: 'Weakest link', value: '—', sub: `${s.linkCount} link${s.linkCount === 1 ? '' : 's'} not checked`, tone: 'none' });
  } else {
    tiles.push({ key: 'link', label: 'Weakest link', value: '—', sub: 'no radio links', tone: 'none' });
  }

  // 4 · Dead zones
  if (cov) {
    const zones = cov.deadZones ?? [];
    const km2 = zones.reduce((a, z) => a + (z.areaKm2 ?? 0), 0);
    tiles.push({
      key: 'gaps', label: 'Dead zones', value: String(zones.length),
      sub: zones.length ? `${fmtKm2(km2)} km² · largest ${fmtKm2(zones[0].areaKm2 ?? 0)} km²` : 'none inside the area',
      tone: zones.length ? 'warn' : 'ok',
    });
  } else {
    tiles.push({ key: 'gaps', label: 'Dead zones', value: '—', sub: 'no run yet', tone: 'none' });
  }

  // 5 · PACE
  const legs = s.pace?.legs ?? null;
  if (legs?.length) {
    const boxes = legs.map((l) => ({ tier: l.tier, state: legFilled(l) ? 'ok' : l.status === 'recommend' ? 'warn' : 'none' }));
    const filled = boxes.filter((b) => b.state === 'ok').length;
    const acquire = boxes.filter((b) => b.state === 'warn').length;
    tiles.push({
      key: 'pace', label: 'PACE', value: `${filled} of ${legs.length}`,
      sub: acquire ? `${acquire} to acquire` : filled === legs.length ? 'all tiers carried' : `${legs.length - filled} open`,
      tone: filled === legs.length ? 'ok' : filled ? 'warn' : 'bad', boxes,
    });
  } else {
    tiles.push({ key: 'pace', label: 'PACE', value: '—', sub: 'no plan yet', tone: 'none' });
  }

  return tiles;
}

/**
 * Add an event, newest first, capped, and skip a repeat of the newest one.
 * Pure: returns a new array.
 * @param {Array<{t:string,text:string}>} events
 * @param {{t:string,text:string,action?:string,onAction?:Function}} ev
 */
export function addEvent(events, ev, max = MAX_EVENTS) {
  if (events[0]?.text === ev.text) return events;
  return [ev, ...events].slice(0, max);
}

const TIER_CHAR = { primary: 'P', alternate: 'A', contingency: 'C', emergency: 'E' };

/**
 * Render the rail into a host. `update(snapshot)` redraws the tiles,
 * `event(text, { action, onAction })` prepends an event.
 */
export function createOpsRail(host, { onTile } = {}) {
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'ops-rail__head';
  head.textContent = 'Mission status';
  const tilesEl = document.createElement('div');
  tilesEl.className = 'ops-rail__tiles';
  const evHead = document.createElement('div');
  evHead.className = 'ops-rail__head ops-rail__head--events';
  evHead.textContent = 'Events';
  const evList = document.createElement('ol');
  evList.className = 'ops-events';
  host.append(head, tilesEl, evHead, evList);

  let events = [];

  function renderEvents() {
    evList.innerHTML = '';
    if (!events.length) {
      const li = document.createElement('li');
      li.className = 'ops-events__empty';
      li.textContent = 'Nothing yet — runs, checks and changes land here.';
      evList.appendChild(li);
      return;
    }
    for (const ev of events) {
      const li = document.createElement('li');
      li.className = 'ops-events__item';
      const t = document.createElement('span');
      t.className = 'ops-events__time';
      t.setAttribute('data-numeric', '');
      t.textContent = ev.t;
      const text = document.createElement('span');
      text.className = 'ops-events__text';
      text.textContent = ev.text;
      li.append(t, text);
      if (ev.action && ev.onAction) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ops-events__action';
        b.textContent = ev.action;
        b.addEventListener('click', ev.onAction);
        li.appendChild(b);
      }
      evList.appendChild(li);
    }
  }

  function tileEl(t) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ops-tile ops-tile--${t.tone}`;
    b.dataset.key = t.key;
    b.setAttribute('aria-label', `${t.label}: ${t.value}, ${t.sub}`);
    const label = document.createElement('span');
    label.className = 'ops-tile__label';
    label.textContent = t.label;
    const value = document.createElement('span');
    value.className = 'ops-tile__value';
    value.setAttribute('data-numeric', '');
    value.textContent = t.value;
    const sub = document.createElement('span');
    sub.className = 'ops-tile__sub';
    sub.textContent = t.sub;
    b.append(label, value);
    if (t.boxes) {
      const row = document.createElement('span');
      row.className = 'ops-tile__boxes';
      for (const box of t.boxes) {
        const s = document.createElement('span');
        s.className = `ops-tile__box ops-tile__box--${box.state}`;
        s.textContent = TIER_CHAR[box.tier] ?? (box.tier?.[0] ?? '?').toUpperCase();
        s.title = `${box.tier}: ${box.state === 'ok' ? 'carried' : box.state === 'warn' ? 'not carried — acquire' : 'open'}`;
        row.appendChild(s);
      }
      b.appendChild(row);
    }
    if (t.dims) {
      const row = document.createElement('span');
      row.className = 'ops-tile__dots';
      for (const [k, v] of Object.entries(t.dims)) {
        const d = document.createElement('span');
        d.className = `ops-tile__dot ${v == null ? 'is-none' : v >= 75 ? 'is-ok' : v >= 40 ? 'is-warn' : 'is-bad'}`;
        d.title = `${k}: ${v == null ? 'not assessed' : v}`;
        row.appendChild(d);
      }
      b.appendChild(row);
    }
    b.appendChild(sub);
    b.addEventListener('click', () => onTile?.(t.key));
    return b;
  }

  renderEvents();
  return {
    update(snapshot) {
      tilesEl.innerHTML = '';
      for (const t of tileModel(snapshot)) tilesEl.appendChild(tileEl(t));
    },
    event(text, { action, onAction, at = new Date() } = {}) {
      const t = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      events = addEvent(events, { t, text, action, onAction });
      renderEvents();
    },
    events: () => events.slice(),
  };
}
