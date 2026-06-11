/**
 * M21 §B — focus mode: any left-menu section expands to a fullscreen surface
 * over the map (the map keeps living underneath — no teardown, just a
 * resize). The section's existing DOM node is PORTALLED into the surface
 * (moved, not cloned — one source of truth, all wiring intact) and moved back
 * on exit; a comment marker holds its home position.
 *
 * Pure state machine first (unit-tested with a stubbed mover); the DOM
 * controller below supplies the real portal, the surface chrome, Esc/⤡ exit
 * and the per-section expand buttons.
 */
import { MODULE_ICONS } from './icons.js';
import { groupFor } from './groups.js';
import { renderBadge } from './badges.js';

// ── Pure core ───────────────────────────────────────────────────────────────

/** Next focused key for an action; null = idle (back on the map). */
export function focusTransition(current, action, key = null) {
  if (action === 'enter' || action === 'switch') return key ?? current;
  if (action === 'exit' || action === 'esc') return null;
  return current;
}

/**
 * Portal bookkeeping around an injected mover: move(key, 'surface'|'home').
 * Guarantees a node is ported at most once and always restored on switch/exit.
 */
export function createFocusMachine({ move } = {}) {
  let current = null;

  function enter(key) {
    if (!key || key === current) return current;
    if (current) move?.(current, 'home');
    move?.(key, 'surface');
    current = key;
    return current;
  }

  function exit() {
    if (!current) return null;
    move?.(current, 'home');
    current = null;
    return null;
  }

  return { enter, exit, current: () => current, isActive: () => current != null };
}

/** Sort dashboard rows by column; case-insensitive strings, nulls last. */
export function sortEntries(rows, col, dir = 1) {
  return [...rows].sort((a, b) => {
    const va = a[col];
    const vb = b[col];
    const na = va == null;
    const nb = vb == null;
    if (na || nb) return na && nb ? 0 : na ? 1 : -1; // missing values sink
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true }) * dir;
  });
}

// ── DOM controller ──────────────────────────────────────────────────────────

const EXPAND_ICON =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h5v5"/><path d="M20 4l-6 6"/><path d="M9 20H4v-5"/><path d="M4 20l6-6"/></svg>';
const COLLAPSE_ICON =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 9h-5V4"/><path d="M15 9l6-6"/><path d="M4 15h5v5"/><path d="M9 15l-6 6"/></svg>';

/**
 * createFocusMode({ host, panelBody, modules, dashboards, onEnter, onExit })
 *
 *   host       — the map wrap the surface overlays
 *   panelBody  — the left panel body holding the .section nodes
 *   modules    — TOOLBAR_MODULES ({ key, label, anchor }); anchor is the
 *                focus key (same key the tabs use)
 *   dashboards — { [anchor]: { mount(el), unmount?(), replace? } } richer
 *                layouts (Objects table, Power cards); replace hides the
 *                portalled form, otherwise the dashboard sits beside it
 *   onEnter(key, module) / onExit() — panel collapse + map.resize hooks
 */
export function createFocusMode({ host, panelBody, modules = [], dashboards = {}, onEnter, onExit } = {}) {
  const byAnchor = new Map(modules.map((m) => [m.anchor, m]));
  const sections = new Map(); // anchor -> section element
  for (const section of panelBody.querySelectorAll('.section')) {
    const key = section.getAttribute('aria-labelledby') || section.id || '';
    if (byAnchor.has(key)) sections.set(key, section);
  }

  // ── Surface chrome ─────────────────────────────────────────────────────
  const surface = document.createElement('div');
  surface.className = 'focus-surface';
  surface.hidden = true;
  surface.setAttribute('role', 'region');
  surface.innerHTML =
    `<header class="focus-head">` +
    `<span class="focus-head__icon" aria-hidden="true"></span>` +
    `<span class="focus-head__crumb"><span class="focus-head__group"></span><span class="focus-head__sep" aria-hidden="true">/</span><span class="focus-head__name"></span></span>` +
    `<span class="gl-badge focus-head__badge" hidden></span>` +
    `<span class="focus-head__spacer"></span>` +
    `<button type="button" class="focus-head__close" aria-label="Exit fullscreen" title="Exit fullscreen (Esc)">${COLLAPSE_ICON}</button>` +
    `</header>` +
    `<div class="focus-body"></div>` +
    `<footer class="focus-foot"><kbd>Esc</kbd> exits · the icon strip switches sections</footer>`;
  host.appendChild(surface);

  const body = surface.querySelector('.focus-body');
  const headIcon = surface.querySelector('.focus-head__icon');
  const headGroup = surface.querySelector('.focus-head__group');
  const headName = surface.querySelector('.focus-head__name');
  const headBadge = surface.querySelector('.focus-head__badge');

  // ── Real portal (comment marker holds the home slot) ───────────────────
  const records = new Map(); // key -> { marker, open, scrollTop }
  let activeDash = null;

  function move(key, dest) {
    const section = sections.get(key);
    if (!section) return;
    if (dest === 'surface') {
      const marker = document.createComment('focus-home');
      section.parentNode.insertBefore(marker, section);
      records.set(key, { marker, open: section.dataset.open, scrollTop: panelBody.scrollTop });
      section.dataset.open = 'true'; // disclosure open while focused
      section.classList.add('section--focused');
      body.appendChild(section);
      mountDash(key);
    } else {
      unmountDash();
      const rec = records.get(key);
      records.delete(key);
      section.classList.remove('section--focused');
      if (rec) {
        if (rec.open !== undefined) section.dataset.open = rec.open;
        rec.marker.parentNode.insertBefore(section, rec.marker);
        rec.marker.remove();
        panelBody.scrollTop = rec.scrollTop ?? panelBody.scrollTop;
      }
    }
  }

  function mountDash(key) {
    const dash = dashboards[key];
    if (!dash) return;
    const el = document.createElement('div');
    el.className = 'focus-dash';
    body.classList.toggle('focus-body--replace', Boolean(dash.replace));
    body.insertBefore(el, body.firstChild); // dashboard above the portalled form
    dash.mount(el);
    activeDash = { dash, el };
  }

  function unmountDash() {
    if (!activeDash) return;
    activeDash.dash.unmount?.();
    activeDash.el.remove();
    body.classList.remove('focus-body--replace');
    activeDash = null;
  }

  const machine = createFocusMachine({ move });

  function applyChrome(key) {
    const m = byAnchor.get(key);
    if (!m) return;
    headIcon.innerHTML = MODULE_ICONS[m.key] ?? '';
    headGroup.textContent = groupFor(m.key).label;
    headName.textContent = m.label;
    surface.setAttribute('aria-label', `${m.label} — fullscreen`);
  }

  function enter(key) {
    if (!sections.has(key)) return false;
    const wasActive = machine.isActive();
    if (machine.current() === key) return true;
    machine.enter(key);
    applyChrome(key);
    surface.hidden = false;
    onEnter?.(key, byAnchor.get(key), { switched: wasActive });
    surface.querySelector('.focus-head__close')?.focus({ preventScroll: true });
    return true;
  }

  function exit() {
    if (!machine.isActive()) return;
    machine.exit();
    surface.hidden = true;
    headBadge.hidden = true;
    onExit?.();
  }

  surface.querySelector('.focus-head__close').addEventListener('click', exit);

  // Esc exits — capture phase so the map/panel Esc handlers never see it.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && machine.isActive()) {
        e.stopPropagation();
        exit();
      } else if (e.key === 'Tab' && machine.isActive()) {
        trapTab(e);
      }
    },
    true,
  );

  /** Keep Tab inside the surface while it is open (it covers the app). */
  function trapTab(e) {
    const focusables = surface.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const inside = surface.contains(document.activeElement);
    if (!inside) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ── Expand button on every focusable section header ─────────────────────
  for (const [key, section] of sections) {
    const head = section.querySelector('.section__head');
    if (!head) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section__expand';
    btn.title = 'Open fullscreen';
    btn.setAttribute('aria-label', `Open ${byAnchor.get(key)?.label ?? key} fullscreen`);
    btn.innerHTML = EXPAND_ICON;
    btn.addEventListener('click', () => enter(key));
    head.appendChild(btn);
  }

  return {
    enter,
    exit,
    isActive: () => machine.isActive(),
    current: () => machine.current(),
    /** Mirror the M20 module badges onto the surface header (refreshWorkflowUi). */
    setBadges(moduleBadges = {}) {
      const m = byAnchor.get(machine.current());
      if (m) renderBadge(headBadge, moduleBadges[m.key]);
    },
    /** Re-mount the active dashboard (data changed while focused). */
    refreshDash() {
      if (!machine.isActive() || !activeDash) return;
      const key = machine.current();
      unmountDash();
      mountDash(key);
    },
  };
}
