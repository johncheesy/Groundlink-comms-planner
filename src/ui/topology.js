/**
 * M41 — Network topology diagram.
 * M45 — Link-quality edge colouring (M14 × M41).
 *
 * SVG-based diagram of the comms network: which nodes talk to which.
 * Nodes are derived from assignRoles() (the five operational node roles)
 * plus any drone relay or HF/satcom overlays in the PACE plan.
 *
 * Colour coding: teal = base/HQ, azure = mobile/handheld, amber = relay.
 * Interactive: hover/focus highlights that node and its connected edges.
 * Edge quality (M45): teal = good (>10 dB), amber = marginal (3–10 dB),
 *   red/dashed = poor (<3 dB), grey/dashed = unknown/uncomputed.
 * Export: serialises the SVG to a downloadable file.
 */

import { assignRoles } from '../radios/roles.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Vertical tier → y position (0 = top, 3 = bottom)
const TIER = {
  'hq':           0,
  'rebro-static': 1,
  'rebro-mobile': 1,
  'mobile-cp':    2,
  'operator':     3,
};

// CSS class for each role's dot colour
const ROLE_CLS = {
  'hq':           'topo-node--base',
  'rebro-static': 'topo-node--relay',
  'rebro-mobile': 'topo-node--relay',
  'mobile-cp':    'topo-node--mobile',
  'operator':     'topo-node--handheld',
};

// Static comms-chain edges (from → to)
const STATIC_EDGES = [
  ['hq', 'rebro-static'],
  ['hq', 'rebro-mobile'],
  ['rebro-static', 'mobile-cp'],
  ['rebro-mobile', 'mobile-cp'],
  ['mobile-cp', 'operator'],
];

// Condense a label to ≤2 words
const shortLabel = (s) => (s ?? '').split(/[\s\/]+/).slice(0, 2).join(' ');

/** Return computed CSS variable value. */
function cssv(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Lay out nodes on a W×H canvas, grouped by tier. */
function layoutNodes(roles) {
  const W = 440, H = 210, PAD_X = 55, PAD_Y = 36;

  const tiers = new Map();
  for (const r of roles) {
    const t = TIER[r.key] ?? 2;
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t).push(r);
  }
  const tierKeys = [...tiers.keys()].sort((a, b) => a - b);
  const maxTier = tierKeys[tierKeys.length - 1] ?? 0;

  const laid = {};
  for (const [t, nodes] of tiers) {
    const y = PAD_Y + ((t / Math.max(maxTier, 1)) * (H - 2 * PAD_Y));
    nodes.forEach((n, i) => {
      const x = PAD_X + ((i + 1) / (nodes.length + 1)) * (W - 2 * PAD_X);
      laid[n.key] = { x, y, ...n };
    });
  }
  return { laid, W, H };
}

// M45: quality tier from margin value
function marginToQuality(marginDb) {
  if (marginDb == null) return 'unknown';
  if (marginDb > 10) return 'good';
  if (marginDb > 3)  return 'warn';
  return 'poor';
}

/** Build the SVG element for the current data state. */
function buildSvg(roles, paceLegs, linkMargins = {}) {
  const { laid, W, H } = layoutNodes(roles);
  const keys = Object.keys(laid);

  // Derive PACE band per node key for badge labels
  const paceTierByBand = {};
  for (const leg of (paceLegs ?? [])) {
    if (leg.band && leg.tier) paceTierByBand[leg.band] = leg.tier;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'topo-svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Comms network topology diagram');

  // ── Defs: arrowhead marker ────────────────────────────────────────────
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.id = 'topo-arrow';
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPoly = document.createElementNS(SVG_NS, 'polygon');
  arrowPoly.setAttribute('points', '0,0 8,4 0,8');
  arrowPoly.setAttribute('class', 'topo-arrow-fill');
  marker.appendChild(arrowPoly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // ── Edges ─────────────────────────────────────────────────────────────
  const edgeG = document.createElementNS(SVG_NS, 'g');
  edgeG.setAttribute('class', 'topo-edges');
  const edgeMap = {}; // "from:to" → <line>

  // M45: shared tooltip element (positioned over the SVG on hover)
  let tipEl = null; // created lazily in the host DOM

  for (const [fromKey, toKey] of STATIC_EDGES) {
    const a = laid[fromKey], b = laid[toKey];
    if (!a || !b) continue;
    // Shorten line so it doesn't overlap the node circles (r≈17)
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const r = 18;
    const x1 = a.x + (dx / dist) * r;
    const y1 = a.y + (dy / dist) * r;
    const x2 = b.x - (dx / dist) * (r + 4); // +4 for arrowhead
    const y2 = b.y - (dy / dist) * (r + 4);

    // M45: quality class
    const edgeKey = `${fromKey}:${toKey}`;
    const margin = linkMargins[edgeKey];
    const quality = marginToQuality(margin?.marginDb);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1.toFixed(1));
    line.setAttribute('y1', y1.toFixed(1));
    line.setAttribute('x2', x2.toFixed(1));
    line.setAttribute('y2', y2.toFixed(1));
    line.setAttribute('class', `topo-edge topo-edge--quality-${quality}`);
    line.dataset.from = fromKey;
    line.dataset.to = toKey;
    line.dataset.marginDb = margin?.marginDb ?? '';
    line.dataset.model = margin?.model ?? '';
    line.setAttribute('marker-end', 'url(#topo-arrow)');
    edgeG.appendChild(line);
    edgeMap[edgeKey] = line;
  }
  svg.appendChild(edgeG);

  // ── Nodes ─────────────────────────────────────────────────────────────
  const nodeG = document.createElementNS(SVG_NS, 'g');
  nodeG.setAttribute('class', 'topo-nodes');

  for (const key of keys) {
    const n = laid[key];
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `topo-node ${ROLE_CLS[key] ?? ''}`);
    g.dataset.key = key;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', n.label + (n.radio ? ` — ${n.radio.label ?? n.radio.model ?? ''}` : ''));

    // Outer ring
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', n.x);
    ring.setAttribute('cy', n.y);
    ring.setAttribute('r', 18);
    ring.setAttribute('class', 'topo-node__ring');

    // Filled dot
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', n.x);
    dot.setAttribute('cy', n.y);
    dot.setAttribute('r', 12);
    dot.setAttribute('class', 'topo-node__dot');

    // Primary label (role name)
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', n.x);
    label.setAttribute('y', n.y + 32);
    label.setAttribute('class', 'topo-label');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = shortLabel(n.label);

    // Sub-label (radio callsign/model)
    const radioName = n.radio?.callsign ?? n.radio?.label ?? n.radio?.model ?? '';
    const sub = document.createElementNS(SVG_NS, 'text');
    sub.setAttribute('x', n.x);
    sub.setAttribute('y', n.y + 44);
    sub.setAttribute('class', 'topo-sublabel');
    sub.setAttribute('text-anchor', 'middle');
    sub.textContent = radioName ? radioName.slice(0, 15) : '—';

    g.append(ring, dot, label, sub);
    nodeG.appendChild(g);
  }
  svg.appendChild(nodeG);

  // ── Interactivity ─────────────────────────────────────────────────────
  function highlight(key, on) {
    for (const [eKey, line] of Object.entries(edgeMap)) {
      const [f, t] = eKey.split(':');
      const active = (f === key || t === key);
      line.classList.toggle('topo-edge--hi', on && active);
      line.classList.toggle('topo-edge--dim', on && !active);
    }
    for (const ng of nodeG.querySelectorAll('.topo-node')) {
      ng.classList.toggle('topo-node--dim', on && ng.dataset.key !== key);
    }
  }

  for (const ng of nodeG.querySelectorAll('.topo-node')) {
    const k = ng.dataset.key;
    ng.addEventListener('mouseenter', () => highlight(k, true));
    ng.addEventListener('mouseleave', () => highlight(k, false));
    ng.addEventListener('focus', () => highlight(k, true));
    ng.addEventListener('blur', () => highlight(k, false));
  }

  return svg;
}

/**
 * Create the topology panel widget.
 *
 * @param {HTMLElement} host   — container element in index.html
 * @param {object} opts
 * @param {() => object[]}    opts.getArsenal      — radios.getArsenal()
 * @param {() => object|null} opts.getLastPlan     — () => lastPlan
 * @param {() => object}      opts.getRoleContext  — gatherRoleContext()
 * @param {() => object}      opts.getLinkMargins  — M45: () => { 'hq:rebro-static': { marginDb, model }, … }
 */
export function createTopologyPanel(host, { getArsenal, getLastPlan, getRoleContext, getLinkMargins } = {}) {
  let currentSvg = null;

  // ── Shell ──────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'topo-wrap';

  const hdr = document.createElement('div');
  hdr.className = 'topo-hdr';

  const title = document.createElement('span');
  title.className = 'field-label';
  title.textContent = 'Network topology';

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'btn btn--sm';
  dlBtn.textContent = 'Export SVG';
  dlBtn.title = 'Download topology as SVG';
  dlBtn.addEventListener('click', () => {
    if (!currentSvg) return;
    const str = new XMLSerializer().serializeToString(currentSvg);
    const blob = new Blob([str], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `groundlink-topology-${Date.now()}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  });

  hdr.append(title, dlBtn);

  const svgWrap = document.createElement('div');
  svgWrap.className = 'topo-svg-wrap';
  svgWrap.setAttribute('aria-live', 'polite');

  // M45: quality key legend
  const qualityKey = document.createElement('div');
  qualityKey.className = 'topo-quality-key';
  qualityKey.innerHTML =
    `<span class="topo-key-swatch topo-key--good"></span>Good (&gt;10 dB)&ensp;` +
    `<span class="topo-key-swatch topo-key--warn"></span>Marginal (3–10 dB)&ensp;` +
    `<span class="topo-key-swatch topo-key--poor"></span>Poor (&lt;3 dB)&ensp;` +
    `<span class="topo-key-swatch topo-key--unknown"></span>Uncomputed`;

  // M45: tooltip element
  const tipEl = document.createElement('div');
  tipEl.className = 'topo-edge-tip';
  tipEl.hidden = true;

  wrap.append(hdr, svgWrap, qualityKey, tipEl);
  host.appendChild(wrap);

  // M45: wire edge hover tooltips after each SVG render
  function wireEdgeTips(svg) {
    for (const line of svg.querySelectorAll('.topo-edge')) {
      line.addEventListener('mouseenter', (ev) => {
        const from = line.dataset.from ?? '';
        const to   = line.dataset.to   ?? '';
        const mDb  = line.dataset.marginDb;
        const mdl  = line.dataset.model;
        const fromLabel = from.replace(/-/g, ' ');
        const toLabel   = to.replace(/-/g, ' ');
        tipEl.textContent = mDb
          ? `${fromLabel} → ${toLabel} | ${Number(mDb).toFixed(1)} dB margin | ${mdl || 'FSPL'}`
          : `${fromLabel} → ${toLabel} | run coverage to compute margin`;
        tipEl.hidden = false;
        // position near cursor relative to svgWrap
        const rect = svgWrap.getBoundingClientRect();
        tipEl.style.left = `${ev.clientX - rect.left + 8}px`;
        tipEl.style.top  = `${ev.clientY - rect.top  - 28}px`;
      });
      line.addEventListener('mouseleave', () => { tipEl.hidden = true; });
      line.addEventListener('mousemove', (ev) => {
        const rect = svgWrap.getBoundingClientRect();
        tipEl.style.left = `${ev.clientX - rect.left + 8}px`;
        tipEl.style.top  = `${ev.clientY - rect.top  - 28}px`;
      });
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────
  function update() {
    const arsenal = getArsenal?.() ?? [];
    const ctx = getRoleContext?.() ?? {};
    const plan = getLastPlan?.();
    const margins = getLinkMargins?.() ?? {};
    const roles = assignRoles(arsenal, ctx);

    currentSvg = buildSvg(roles, plan?.legs ?? [], margins);
    svgWrap.innerHTML = '';
    svgWrap.appendChild(currentSvg);
    wireEdgeTips(currentSvg);

    // M45: show "unplaced" note if no margins computed yet
    const hasAny = Object.keys(margins).length > 0;
    let note = svgWrap.querySelector('.topo-unplaced-note');
    if (!hasAny) {
      if (!note) {
        note = document.createElement('p');
        note.className = 'topo-unplaced-note';
        note.textContent = 'Run coverage to compute link-budget margins per edge.';
        svgWrap.appendChild(note);
      }
    } else {
      note?.remove();
    }
  }

  return { update };
}
