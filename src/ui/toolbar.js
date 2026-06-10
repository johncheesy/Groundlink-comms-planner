/**
 * M19 (rev 2) — top icon toolbar. One icon per left-panel tab, in section
 * order; clicking opens/closes that tab in the left menu (the right side of
 * the screen stays free for the map). Right side: search, basemap, theme
 * toggle, settings. aria-pressed mirrors the tab's open state.
 *
 * Keyboard: one tab stop with a roving tabindex; ←/→ move between buttons.
 */
import { MODULE_ICONS } from './icons.js';

/** Toolbar tabs in panel-section order; anchor = section heading id = tab key. */
export const TOOLBAR_MODULES = [
  { key: 'objects', label: 'Objects', anchor: 'objectsTitle' },
  { key: 'mission', label: 'Mission', anchor: 'missionTitle' },
  { key: 'aoi', label: 'Area of interest', anchor: 'aoiTitle' },
  { key: 'radios', label: 'Radios', anchor: 'radioTitle' },
  { key: 'roles', label: 'Node roles', anchor: 'rolesTitle' },
  { key: 'coverage', label: 'Coverage', anchor: 'coverageTitle' },
  { key: 'sites', label: 'Site recommendation', anchor: 'siteTitle' },
  { key: 'drone', label: 'Drone relay', anchor: 'droneTitle' },
  { key: 'pace', label: 'Comms plan', anchor: 'paceTitle' },
  { key: 'export', label: 'Data export', anchor: 'dataExportTitle' },
  { key: 'power', label: 'Power & endurance', anchor: 'powerTitle' },
  { key: 'cellular', label: 'Cellular coverage', anchor: 'cellTitle' },
  { key: 'layers', label: 'Layers', anchor: 'featTitle' },
];

/** The section element a heading id belongs to. */
export function sectionForAnchor(anchorId) {
  return document.getElementById(anchorId)?.closest('.section') ?? null;
}

export function createToolbar(els, { onModule, onSearch, onBasemap, onSettings } = {}) {
  const { modulesHost, rightHost } = els;
  const moduleButtons = new Map(); // anchor -> button

  function iconButton(key, label, icon, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar__btn';
    btn.dataset.module = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('click', handler);
    return btn;
  }

  for (const m of TOOLBAR_MODULES) {
    const btn = iconButton(m.key, m.label, MODULE_ICONS[m.key], () => onModule?.(m));
    btn.setAttribute('aria-pressed', 'false');
    moduleButtons.set(m.anchor, btn);
    modulesHost.appendChild(btn);
  }

  rightHost.prepend(
    iconButton('search', 'Search place or coordinate', MODULE_ICONS.search, () => onSearch?.()),
    iconButton('basemap', 'Switch basemap', MODULE_ICONS.basemap, () => onBasemap?.()),
  );
  rightHost.appendChild(
    iconButton('settings', 'Settings', MODULE_ICONS.settings, () => onSettings?.()),
  );

  // Roving tabindex across every toolbar button (incl. the relocated theme
  // toggle, which is already in rightHost's markup).
  const allButtons = () => [...els.root.querySelectorAll('button')];
  allButtons().forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
  els.root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = allButtons();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list.forEach((b) => { b.tabIndex = -1; });
    list[next].tabIndex = 0;
    list[next].focus();
  });

  /** Mirror one tab's open state on its icon (multiple can be active). */
  function setPressed(anchor, on) {
    const b = moduleButtons.get(anchor);
    if (!b) return;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  }

  return { setPressed };
}
