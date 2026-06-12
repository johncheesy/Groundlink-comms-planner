/**
 * M19 §3 — per-object context menu. buildMenuModel() is pure (unit-tested);
 * createContextMenu() renders one DOM menu used from both anchors — map
 * markers (right-click) and right-panel rows (kebab / right-click).
 *
 * Menu: header (name + kind) · coords in lat/long, MGRS, UTM (click-to-copy)
 * · Rename… (inline input) · Settings… (RF kinds) · Move / Unlock · Delete
 * (two-step confirm). role="menu", keyboard navigable, Esc/outside closes.
 */
import { formatCoordinate } from '../geo/coords.js';
import { KIND_LABEL } from './objects.js';

export const COORD_MENU_FORMATS = ['latlng', 'mgrs', 'utm'];
const FMT_LABEL = { latlng: 'Lat/Long', mgrs: 'MGRS', utm: 'UTM' };

/** Kinds with per-object RF relevance → a Settings… item. */
const SETTINGS_KINDS = ['tx', 'mast', 'repeater', 'drone'];

/**
 * Pure menu model for one registry entry:
 *   { header: {name, kind}, coords: [{fmt, label, text}], items: [{id, label}] }
 */
export function buildMenuModel(entry) {
  const pt = { lat: entry.lngLat[1], lng: entry.lngLat[0] };
  const coords = COORD_MENU_FORMATS.map((fmt) => ({
    fmt,
    label: FMT_LABEL[fmt],
    text: formatCoordinate(pt, fmt),
  }));
  const items = [{ id: 'rename', label: 'Rename…' }];
  if (SETTINGS_KINDS.includes(entry.kind)) {
    items.push({ id: 'settings', label: 'Settings…' });
    items.push({ id: 'optimise', label: 'Optimise height…' }); // M35 wizard
  }
  items.push(entry.locked ? { id: 'unlock', label: 'Unlock' } : { id: 'move', label: 'Move' });
  items.push({ id: 'delete', label: 'Delete' });
  return {
    header: { name: entry.name, kind: KIND_LABEL[entry.kind] || entry.kind },
    coords,
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM menu (one instance, two anchors)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * opts: { registry, onAction(action, entry), onStatus }
 * onAction handles 'settings' | 'move'; rename/delete/unlock/copy are wired
 * here through the registry.
 */
export function createContextMenu(opts) {
  const { registry, onAction, onStatus } = opts;
  let el = null;
  let entryId = null;

  function close() {
    el?.remove();
    el = null;
    entryId = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e) {
    if (el && !el.contains(e.target)) close();
  }

  function focusables() {
    return el ? [...el.querySelectorAll('[role="menuitem"], input')] : [];
  }

  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = focusables();
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }

  function copyRow(text) {
    try {
      navigator.clipboard?.writeText(text);
      onStatus?.('Coordinate copied');
    } catch { /* clipboard unavailable */ }
  }

  /** Open the menu for a registry entry at viewport coords (x, y). */
  function openFor(id, x, y) {
    close();
    const entry = registry.get(id);
    if (!entry) return;
    entryId = id;
    const model = buildMenuModel(entry);

    el = document.createElement('div');
    el.className = 'objmenu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', `Options for ${model.header.name}`);

    const head = document.createElement('div');
    head.className = 'objmenu__head';
    head.innerHTML = '<strong class="objmenu__name"></strong><span class="objmenu__kind"></span>';
    head.querySelector('.objmenu__name').textContent = model.header.name;
    head.querySelector('.objmenu__kind').textContent = model.header.kind;
    el.appendChild(head);

    for (const c of model.coords) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'objmenu__coord';
      row.setAttribute('role', 'menuitem');
      row.title = `Copy ${c.label}`;
      row.innerHTML = '<span class="objmenu__fmt"></span><span class="objmenu__val" data-numeric></span>';
      row.querySelector('.objmenu__fmt').textContent = c.label;
      row.querySelector('.objmenu__val').textContent = c.text;
      row.addEventListener('click', () => copyRow(c.text));
      el.appendChild(row);
    }

    const sep = document.createElement('div');
    sep.className = 'objmenu__sep';
    sep.setAttribute('role', 'separator');
    el.appendChild(sep);

    for (const item of model.items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `objmenu__item objmenu__item--${item.id}`;
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      btn.addEventListener('click', () => runItem(item.id, btn));
      el.appendChild(btn);
    }

    document.body.appendChild(el);
    // Keep the menu inside the viewport.
    const r = el.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    el.style.left = `${Math.max(8, px)}px`;
    el.style.top = `${Math.max(8, py)}px`;

    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    el.querySelector('.objmenu__item')?.focus();
  }

  function runItem(action, btn) {
    const entry = registry.get(entryId);
    if (!entry) { close(); return; }
    if (action === 'rename') {
      startRename(btn, entry);
      return;
    }
    if (action === 'delete') {
      // Two-step confirm in place — no separate dialog.
      if (btn.dataset.confirm !== 'true') {
        btn.dataset.confirm = 'true';
        btn.textContent = 'Confirm delete?';
        return;
      }
      registry.remove(entry.id);
      onStatus?.(`${entry.name} deleted`);
      close();
      return;
    }
    if (action === 'unlock') {
      registry.setLocked(entry.id, false);
      onStatus?.(`${entry.name} unlocked`);
      close();
      return;
    }
    // 'settings' | 'move' — owner-specific, handled by the caller.
    close();
    onAction?.(action, entry);
  }

  function startRename(btn, entry) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'objmenu__rename';
    input.value = entry.name;
    input.setAttribute('aria-label', 'New name');
    btn.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== entry.name) {
        registry.rename(entry.id, v);
        onStatus?.('Renamed');
      }
      close();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('change', commit);
  }

  return { openFor, close, isOpen: () => Boolean(el) };
}
