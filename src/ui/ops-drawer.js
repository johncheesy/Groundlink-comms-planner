/**
 * M52 phase 3 — the data drawer under the map: a header strip that carries
 * the run summary and the assumptions line (what the result card showed),
 * tabs, and one sortable table per tab. Sites and Links are live; Gaps and
 * Radios follow in phase 4. Row data is prepared by the caller from the
 * mission and the link checks; nothing here computes RF.
 *
 * Pure helpers first (unit-tested, DOM-free); createOpsDrawer() wires the DOM.
 */

import { haversineM } from '../coverage/model.js';
import { linkVerdict } from '../analysis/path-profile.js';

const fmt1 = (v) => (Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—');
const fmtKm = (m) => (m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export const SITE_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'heightM', label: 'Height', unit: 'm', numeric: true },
  { key: 'powerW', label: 'Power', unit: 'W', numeric: true },
  { key: 'eirpDbm', label: 'EIRP', unit: 'dBm', numeric: true },
  { key: 'azimuthDeg', label: 'Aim', unit: '°', numeric: true },
  { key: 'links', label: 'Links', numeric: true },
  { key: 'status', label: 'Status' },
];

export const LINK_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'ends', label: 'A → B' },
  { key: 'lengthM', label: 'Length', numeric: true },
  { key: 'freqMHz', label: 'Band', unit: 'MHz', numeric: true },
  { key: 'marginDb', label: 'Margin', unit: 'dB', numeric: true },
  { key: 'status', label: 'Verdict' },
];

const STATUS_RANK = { bad: 0, warn: 1, ok: 2, unknown: 3 };
const STATUS_WORD = { ok: 'closes', warn: 'tight', bad: 'does not close', unknown: 'not checked' };

/**
 * One row per radio link. Pure.
 * @param {Array<{id,a,b,label,freqMHz?}>} links
 * @param {Array<{id,name,lat,lng}>} sites
 * @param {(link) => object|null} checkFor   current path-profile check or null
 */
export function linkRows(links, sites, checkFor = () => null) {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return links
    .map((l) => {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      if (!a || !b) return null;
      const check = checkFor(l);
      const v = linkVerdict(check);
      const status = check ? v.status : 'unknown';
      return {
        id: l.id,
        name: l.label || `${a.name || 'Site'} – ${b.name || 'Site'}`,
        ends: `${a.name || 'Site'} → ${b.name || 'Site'}`,
        lengthM: haversineM(a.lat, a.lng, b.lat, b.lng),
        freqMHz: l.freqMHz ?? null,
        marginDb: check?.budget?.marginDb ?? null,
        status,
        statusText: check ? (status === 'ok' ? STATUS_WORD.ok : v.text || STATUS_WORD[status]) : STATUS_WORD.unknown,
      };
    })
    .filter(Boolean);
}

/**
 * One row per fixed site; status is the worst of its checked links. Pure.
 * @param {Array<{id,name,lat,lng,azimuthDeg?,txHeightM?,powerW?}>} sites
 * @param {ReturnType<typeof linkRows>} linkRowsOf  rows from linkRows()
 * @param {Array<{id,a,b}>} links
 * @param {{ heightM:number, powerW:number, eirpDbm:(powerW:number)=>number }} defaults
 */
export function siteRows(sites, linkRowsOf, links, defaults) {
  const rowById = new Map(linkRowsOf.map((r) => [r.id, r]));
  return sites.map((s) => {
    const mine = links.filter((l) => l.a === s.id || l.b === s.id).map((l) => rowById.get(l.id)).filter(Boolean);
    const checked = mine.filter((r) => r.status !== 'unknown');
    const status = checked.length ? checked.reduce((w, r) => (STATUS_RANK[r.status] < STATUS_RANK[w] ? r.status : w), 'ok') : 'unknown';
    const powerW = s.powerW ?? defaults.powerW;
    return {
      id: s.id,
      name: s.name || 'Site',
      heightM: s.txHeightM ?? defaults.heightM,
      ownHeight: s.txHeightM != null,
      powerW,
      ownPower: s.powerW != null,
      eirpDbm: defaults.eirpDbm(powerW),
      azimuthDeg: s.azimuthDeg ?? null,
      links: mine.length,
      status,
      statusText: mine.length ? (checked.length ? `${checked.length} of ${mine.length} checked` : 'links not checked') : 'no links',
    };
  });
}

/** Sort rows by a column; nulls last; strings case-insensitive. Pure. */
export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    if (key === 'status') return (STATUS_RANK[x] - STATUS_RANK[y]) * sign;
    return String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true }) * sign;
  });
}

/** Summary strip text from a coverage summary. Pure. */
export function summaryFigures(summary) {
  if (!summary) return null;
  const z = summary.deadZones?.length ?? 0;
  return {
    covered: `${Math.round(summary.coveredPct)} %`,
    zones: `${z} dead zone${z === 1 ? '' : 's'}`,
    weakest: `${summary.weakestBelow ? '< ' : '≥ '}${Math.round(summary.weakestDbm)} dBm`,
  };
}

const TABS = [
  { key: 'sites', label: 'Sites', live: true },
  { key: 'links', label: 'Links', live: true },
  { key: 'gaps', label: 'Gaps', live: false },
  { key: 'radios', label: 'Radios', live: false },
];

/**
 * @param {HTMLElement} host   the `.ops-drawer` grid cell
 * @param {object} o
 * @param {HTMLElement} o.app  the `.app` element (gets data-drawer="open")
 * @param {(siteId:string)=>void} [o.onSite]       row click
 * @param {(linkId:string)=>void} [o.onLink]       row click
 * @param {(linkId:string)=>void} [o.onProfile]    Profile button
 * @param {Record<string,()=>void>} [o.actions]    { relay, gaps, brief }
 */
export function createOpsDrawer(host, { app, onSite, onLink, onProfile, actions = {} } = {}) {
  host.innerHTML = '';
  host.removeAttribute('role');
  const bar = el('div', 'ops-drawer__bar');
  const tabsEl = el('div', 'ops-drawer__tabs', { role: 'tablist', 'aria-label': 'Mission data' });
  const tabEls = new Map();
  for (const t of TABS) {
    const b = el('button', 'ops-drawer__tab', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-key': t.key });
    if (!t.live) { b.disabled = true; b.title = `${t.label} table — phase 4`; }
    b.innerHTML = `<span class="ops-drawer__tab-label">${t.label}</span><span class="ops-drawer__tab-count" data-numeric>—</span>`;
    b.addEventListener('click', () => { if (active === t.key && open) setOpen(false); else { active = t.key; setOpen(true); } });
    tabsEl.appendChild(b);
    tabEls.set(t.key, b);
  }
  const strip = el('div', 'ops-drawer__strip');
  const figs = el('span', 'ops-drawer__figs');
  const assump = el('span', 'ops-drawer__assump', { 'data-numeric': '' });
  const warn = el('span', 'ops-drawer__warn', { hidden: '' });
  strip.append(figs, warn, assump);
  const acts = el('div', 'ops-drawer__actions');
  const ACTIONS = [['relay', 'Relay advice'], ['gaps', 'Gap report'], ['brief', 'Brief']];
  for (const [k, label] of ACTIONS) {
    if (!actions[k]) continue;
    const b = el('button', 'ops-drawer__act', { type: 'button', hidden: '' });
    b.textContent = label;
    b.addEventListener('click', actions[k]);
    acts.appendChild(b);
  }
  const toggle = el('button', 'ops-drawer__toggle', { type: 'button', 'aria-expanded': 'false', 'aria-label': 'Open the data drawer' });
  toggle.textContent = '▴';
  toggle.addEventListener('click', () => setOpen(!open));
  bar.append(tabsEl, strip, acts, toggle);
  const body = el('div', 'ops-drawer__body', { hidden: '' });
  host.append(bar, body);

  let active = 'sites';
  let open = false;
  let data = { sites: [], links: [] };
  let sort = { sites: { key: 'name', dir: 'asc' }, links: { key: 'name', dir: 'asc' } };

  function setOpen(v) {
    open = v;
    app.dataset.drawer = open ? 'open' : 'closed';
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Collapse the data drawer' : 'Open the data drawer');
    toggle.textContent = open ? '▾' : '▴';
    for (const [k, b] of tabEls) b.setAttribute('aria-selected', String(open && k === active));
    if (open) renderTable();
  }

  function renderTable() {
    body.innerHTML = '';
    const cols = active === 'sites' ? SITE_COLUMNS : LINK_COLUMNS;
    const rows = sortRows(data[active] ?? [], sort[active].key, sort[active].dir);
    const table = el('table', 'ops-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const c of cols) {
      const th = el('th', c.numeric ? 'is-num' : '', { scope: 'col' });
      const b = el('button', 'ops-table__sort', { type: 'button' });
      const s = sort[active];
      b.textContent = c.label + (c.unit ? ` (${c.unit})` : '');
      if (s.key === c.key) { b.classList.add('is-on'); b.setAttribute('aria-sort', s.dir === 'asc' ? 'ascending' : 'descending'); b.textContent += s.dir === 'asc' ? ' ▲' : ' ▼'; }
      b.addEventListener('click', () => {
        sort[active] = s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.numeric ? 'desc' : 'asc' };
        renderTable();
      });
      th.appendChild(b);
      hr.appendChild(th);
    }
    if (active === 'links') hr.appendChild(el('th', '', { scope: 'col' }));
    thead.appendChild(hr);
    const tbody = el('tbody');
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'ops-table__empty', { colspan: String(cols.length + 1) });
      td.textContent = active === 'sites' ? 'No fixed sites yet — place a mast or open a mission file.' : 'No radio links yet — right-click a site → Add radio link…';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    for (const r of rows) {
      const tr = el('tr', 'ops-table__row', { 'data-id': r.id, tabindex: '0' });
      for (const c of cols) tr.appendChild(cell(r, c));
      if (active === 'links') {
        const td = el('td', 'is-act');
        const b = el('button', 'ops-table__btn', { type: 'button' });
        b.textContent = 'Profile';
        b.addEventListener('click', (e) => { e.stopPropagation(); onProfile?.(r.id); });
        td.appendChild(b);
        tr.appendChild(td);
      }
      const act = () => (active === 'sites' ? onSite?.(r.id) : onLink?.(r.id));
      tr.addEventListener('click', act);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    body.appendChild(table);
  }

  function cell(r, c) {
    const td = el('td', c.numeric ? 'is-num' : '');
    if (c.numeric) td.setAttribute('data-numeric', '');
    const v = r[c.key];
    if (c.key === 'status') {
      const dot = el('span', `ops-dot ops-dot--${r.status}`);
      td.append(dot, document.createTextNode(` ${r.statusText}`));
    } else if (c.key === 'lengthM') {
      td.textContent = v == null ? '—' : fmtKm(v);
    } else if (c.key === 'marginDb') {
      td.textContent = v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
    } else if (c.key === 'heightM' || c.key === 'powerW') {
      td.textContent = fmt1(v);
      if (!(c.key === 'heightM' ? r.ownHeight : r.ownPower)) td.classList.add('is-default');
      if (!(c.key === 'heightM' ? r.ownHeight : r.ownPower)) td.title = 'From the Coverage panel';
    } else if (c.key === 'eirpDbm') {
      td.textContent = Number.isFinite(v) ? String(Math.round(v)) : '—';
    } else if (c.key === 'azimuthDeg') {
      td.textContent = v == null ? 'omni' : String(Math.round(v));
      if (v == null) td.classList.add('is-default');
    } else {
      td.textContent = v == null ? '—' : String(v);
    }
    return td;
  }

  function setSummary(summary, modelLabel, assumptions) {
    const f = summaryFigures(summary);
    figs.innerHTML = '';
    if (f) {
      for (const [v, cap] of [[f.covered, 'covered'], [f.zones, ''], [f.weakest, 'weakest']]) {
        const s = el('span', 'ops-drawer__fig');
        s.innerHTML = `<b data-numeric></b>${cap ? ` <i></i>` : ''}`;
        s.querySelector('b').textContent = v;
        if (cap) s.querySelector('i').textContent = cap;
        figs.appendChild(s);
      }
      if (modelLabel) {
        const m = el('span', 'ops-drawer__model');
        m.textContent = modelLabel;
        figs.appendChild(m);
      }
    }
    assump.textContent = assumptions?.summary ?? '';
    assump.title = assumptions?.summary ?? '';
    // The first warning as a short chip that always fits ("No radio selected"),
    // every warning in the tooltip: the narrow strip must not hide this.
    const ws = assumptions?.warnings ?? [];
    const w = ws[0] ?? '';
    warn.textContent = w ? `⚠ ${w.split(/[:.]/)[0]}${ws.length > 1 ? ` +${ws.length - 1}` : ''}` : '';
    warn.title = ws.join('\n');
    warn.hidden = !w;
    for (const b of acts.children) b.hidden = !f;
  }

  setOpen(false);
  return {
    /** New rows; counts update at once, the table if open. */
    refresh({ sites = [], links = [] } = {}) {
      data = { sites, links };
      tabEls.get('sites').querySelector('.ops-drawer__tab-count').textContent = String(sites.length);
      tabEls.get('links').querySelector('.ops-drawer__tab-count').textContent = String(links.length);
      if (open) renderTable();
    },
    setSummary,
    clearSummary: () => setSummary(null, null, null),
    open: (tab) => { if (tab) active = tab; setOpen(true); },
    close: () => setOpen(false),
    isOpen: () => open,
    activeTab: () => active,
  };
}

function el(tag, className = '', attrs = {}) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
