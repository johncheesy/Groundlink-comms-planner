/**
 * M52 phase 1 — the Ops workspace shell, behind `?ws=ops`.
 *
 * Top bar (brand · mission · ⌘K · Open · Run · Export · theme), a 46 px tool
 * strip on the left with one icon per module, a status rail host on the
 * right and a data-drawer host under the map. Today's left-panel sections
 * are not rewritten: a strip icon moves that `.section` element into one
 * flyout over the map and moves it back on close, so every handler bound
 * to the section keeps working. Nothing here computes anything; the rail
 * and drawer get their content in phases 2 and 3 (docs/M52-ops-workspace.md).
 *
 * Pure helpers first (unit-tested, DOM-free); createOpsShell() wires the DOM.
 */

import { MODULE_ICONS } from './icons.js';

export const OPS_WS_PARAM = 'ws';
export const OPS_WS_VALUE = 'ops';

/** True when the URL asks for the Ops workspace (`?ws=ops`). Pure. */
export function isOpsWorkspace(search) {
  try {
    return new URLSearchParams(search).get(OPS_WS_PARAM) === OPS_WS_VALUE;
  } catch {
    return false;
  }
}

/** Drawer tabs with their counts; a null count renders as a dash. Pure. */
export function drawerTabs(counts = {}) {
  const n = (v) => (Number.isFinite(v) ? String(v) : '—');
  return [
    { key: 'sites', label: 'Sites', count: n(counts.sites) },
    { key: 'links', label: 'Links', count: n(counts.links) },
    { key: 'gaps', label: 'Gaps', count: n(counts.gaps) },
    { key: 'radios', label: 'Radios', count: n(counts.radios) },
  ];
}

/** The module a section anchor belongs to, or null. Pure. */
export function moduleForAnchor(modules, anchorId) {
  return modules.find((m) => m.anchor === anchorId) ?? null;
}

const SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * Build the shell and move today's chrome into it.
 * @param {object} o
 * @param {HTMLElement} o.app        the `.app` grid
 * @param {HTMLElement} o.mapWrap    the `.map-wrap` (flyout host)
 * @param {Array<{key,label,anchor}>} o.modules  TOOLBAR_MODULES
 * @param {object} o.sectionTabs     createSectionTabs() controller
 * @param {object} o.nodes           existing elements to relocate (any may be null)
 * @param {Function} [o.onOpenFlyout] (module) — e.g. exit focus mode first
 */
export function createOpsShell({ app, mapWrap, modules, sectionTabs, nodes = {}, onOpenFlyout } = {}) {
  app.dataset.ws = OPS_WS_VALUE;

  // ── Top bar ───────────────────────────────────────────────────────────
  const top = el('header', 'ops-top', { role: 'banner', 'aria-label': 'Ops workspace bar' });
  if (nodes.brand) top.appendChild(nodes.brand);
  const missionBtn = el('button', 'ops-top__mission', { type: 'button', title: 'Mission — open the Mission section' });
  missionBtn.innerHTML = '<span class="ops-top__mission-name">Mission</span><span class="ops-top__mission-chev" aria-hidden="true">▾</span>';
  top.appendChild(missionBtn);
  const spacer = el('span', 'ops-top__spacer');
  top.appendChild(spacer);
  const actions = el('div', 'ops-top__actions');
  for (const n of [nodes.open, nodes.run, nodes.brief]) if (n) actions.appendChild(n);
  top.appendChild(actions);
  if (nodes.right) top.appendChild(nodes.right);

  // ── Tool strip ────────────────────────────────────────────────────────
  const strip = el('nav', 'ops-strip', { 'aria-label': 'Sections' });
  const stripBtns = new Map();
  for (const m of modules) {
    const b = el('button', 'ops-strip__btn', { type: 'button', title: m.label, 'aria-label': m.label, 'aria-pressed': 'false', 'data-key': m.key });
    b.innerHTML = MODULE_ICONS[m.key] ?? MODULE_ICONS.objects;
    b.addEventListener('click', () => (openKey === m.key ? close() : open(m)));
    strip.appendChild(b);
    stripBtns.set(m.key, b);
  }

  // ── Status rail host ──────────────────────────────────────────────────
  // Phase 2 fills it (src/ui/ops-rail.js); the shell only owns the column.
  const rail = el('aside', 'ops-rail', { 'aria-label': 'Mission status' });
  rail.innerHTML = '<div class="ops-rail__head">Mission status</div>';

  // ── Data drawer host ──────────────────────────────────────────────────
  const drawer = el('div', 'ops-drawer', { role: 'tablist', 'aria-label': 'Mission data' });
  const tabEls = new Map();
  for (const t of drawerTabs()) {
    const b = el('button', 'ops-drawer__tab', { type: 'button', role: 'tab', 'aria-selected': 'false', disabled: '', title: `${t.label} table — phase 3` });
    b.innerHTML = `<span class="ops-drawer__tab-label">${t.label}</span><span class="ops-drawer__tab-count" data-numeric>${t.count}</span>`;
    drawer.appendChild(b);
    tabEls.set(t.key, b);
  }

  // ── Flyout (one at a time) ────────────────────────────────────────────
  const flyout = el('section', 'ops-flyout', { hidden: '', 'aria-label': 'Section' });
  const flyHead = el('div', 'ops-flyout__head');
  const flyTitle = el('span', 'ops-flyout__title');
  const flyClose = el('button', 'ops-flyout__close', { type: 'button', 'aria-label': 'Close' });
  flyClose.innerHTML = SVG_X;
  flyHead.append(flyTitle, flyClose);
  const flyBody = el('div', 'ops-flyout__body');
  flyout.append(flyHead, flyBody);
  flyClose.addEventListener('click', close);
  mapWrap.appendChild(flyout);

  let openKey = null;
  let moved = null; // { section, placeholder }

  function restore() {
    if (!moved) return;
    moved.placeholder.replaceWith(moved.section);
    moved = null;
    flyBody.textContent = '';
  }

  function open(m) {
    onOpenFlyout?.(m);
    restore();
    const section = document.getElementById(m.anchor)?.closest('.section') ?? null;
    flyTitle.textContent = m.label;
    if (section) {
      const placeholder = document.createComment(`ops-flyout:${m.anchor}`);
      section.replaceWith(placeholder);
      flyBody.appendChild(section);
      moved = { section, placeholder };
      sectionTabs?.setOpen(m.anchor, true);
      if (section.hidden) {
        const note = el('p', 'ops-flyout__note');
        note.textContent = 'Available after a coverage run.';
        flyBody.appendChild(note);
      }
    } else {
      const note = el('p', 'ops-flyout__note');
      note.textContent = 'This section is not on this page.';
      flyBody.appendChild(note);
    }
    openKey = m.key;
    for (const [k, b] of stripBtns) b.setAttribute('aria-pressed', String(k === m.key));
    flyout.hidden = false;
    flyBody.scrollTop = 0;
  }

  function close() {
    restore();
    openKey = null;
    for (const b of stripBtns.values()) b.setAttribute('aria-pressed', 'false');
    flyout.hidden = true;
  }

  missionBtn.addEventListener('click', () => {
    const m = modules.find((x) => x.key === 'mission');
    if (m) openKey === m.key ? close() : open(m);
  });
  // Esc closes; a click on the map canvas closes (not on the flyout itself).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openKey) close(); });
  mapWrap.querySelector('#map')?.addEventListener('pointerdown', () => { if (openKey) close(); });

  app.append(top, strip, rail, drawer);

  return {
    /** The status-rail column (phase 2 renders into it). */
    rail,
    /** Open the flyout that holds this section anchor; false if none. */
    openAnchor(anchorId) {
      const m = moduleForAnchor(modules, anchorId);
      if (!m) return false;
      open(m);
      return true;
    },
    close,
    isOpen: () => openKey != null,
    /** Update the drawer tab counts ({ sites, links, gaps, radios }). */
    refresh(counts) {
      for (const t of drawerTabs(counts)) {
        const c = tabEls.get(t.key)?.querySelector('.ops-drawer__tab-count');
        if (c) c.textContent = t.count;
      }
    },
    /** Rename the mission button (file name or "Mission"). */
    setMissionName(name) {
      missionBtn.querySelector('.ops-top__mission-name').textContent = name || 'Mission';
    },
  };
}

function el(tag, className, attrs = {}) {
  const e = document.createElement(tag);
  e.className = className;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
