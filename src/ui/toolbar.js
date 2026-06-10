/**
 * M19 §1 — top icon toolbar. One icon button per module (same order as the
 * left panel's sections); clicking opens that module's view in the right
 * object panel. Right side: search, basemap, theme toggle, settings.
 *
 * Keyboard: one tab stop with a roving tabindex; ←/→ move between buttons.
 * The left panel keeps the authoritative forms — the toolbar only switches
 * right-panel views and jumps.
 */
import { MODULE_ICONS } from './icons.js';

/** Modules in panel-section order; anchor = left-panel section heading id. */
export const TOOLBAR_MODULES = [
  { key: 'mission', label: 'Mission', anchor: 'missionTitle' },
  { key: 'aoi', label: 'Area of interest', anchor: 'aoiTitle' },
  { key: 'radios', label: 'Radios', anchor: 'radioTitle' },
  { key: 'roles', label: 'Node roles', anchor: 'rolesTitle' },
  { key: 'coverage', label: 'Coverage', anchor: 'coverageTitle' },
  { key: 'sites', label: 'Site recommendation', anchor: 'siteTitle' },
  { key: 'drone', label: 'Drone relay', anchor: 'droneTitle' },
  { key: 'pace', label: 'Comms plan', anchor: 'paceTitle' },
  { key: 'export', label: 'Data export', anchor: 'dataExport' },
  { key: 'power', label: 'Power & endurance', anchor: 'powerTitle' },
  { key: 'cellular', label: 'Cellular coverage', anchor: 'cellTitle' },
  { key: 'layers', label: 'Layers', anchor: 'featTitle' },
];

/** Scroll the left panel to a module's section (expanding the panel first). */
export function sectionForAnchor(anchorId) {
  return document.getElementById(anchorId)?.closest('.section') ?? null;
}

export function createToolbar(els, { onModule, onObjects, onSearch, onBasemap, onSettings } = {}) {
  const { modulesHost, rightHost } = els;
  const buttons = [];

  function iconButton(key, label, icon, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar__btn';
    btn.dataset.module = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = icon;
    btn.addEventListener('click', () => handler(key));
    buttons.push(btn);
    return btn;
  }

  // Objects (default right-panel view) leads the module group.
  modulesHost.appendChild(iconButton('objects', 'Objects', MODULE_ICONS.objects, () => onObjects?.()));
  const sep = document.createElement('span');
  sep.className = 'toolbar__sep';
  sep.setAttribute('aria-hidden', 'true');
  modulesHost.appendChild(sep);
  for (const m of TOOLBAR_MODULES) {
    modulesHost.appendChild(iconButton(m.key, m.label, MODULE_ICONS[m.key], () => onModule?.(m)));
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
  const roving = allButtons();
  roving.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
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

  /** Reflect the active right-panel view on the module icons. */
  function setActive(key) {
    for (const b of buttons) {
      const on = b.dataset.module === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  return { setActive };
}
