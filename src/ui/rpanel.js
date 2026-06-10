/**
 * M19 §2 — right object panel: registry list + thin per-module views, with a
 * drag-resizable divider (200–480 px, double-click reset, arrow-key resize).
 *
 * Pure width/persistence helpers live at the top (unit-tested, DOM-free);
 * createRightPanel() below wires the DOM. Width + open state persist in
 * localStorage (`gl.ui.rpanel.v1`) — UI preference only, same class as the
 * theme; never coordinates (OPSEC).
 */
import { KIND_LABEL, RF_KINDS } from './objects.js';
import { objectIconSvg } from './icons.js';

export const RPANEL_MIN_W = 200;
export const RPANEL_MAX_W = 480;
export const RPANEL_DEFAULT_W = 280;
export const RPANEL_STORE_KEY = 'gl.ui.rpanel.v1';

/** Clamp a candidate width to the 200–480 px band (default for non-numbers). */
export function clampRpanelWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return RPANEL_DEFAULT_W;
  return Math.min(RPANEL_MAX_W, Math.max(RPANEL_MIN_W, Math.round(n)));
}

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // sandboxed preview: storage access itself throws
  }
};

/** Load { w, open } UI prefs; defaults on missing/corrupt/denied storage. */
export function loadRpanelPrefs(storage = defaultStorage()) {
  const fallback = { w: RPANEL_DEFAULT_W, open: true };
  try {
    const raw = storage?.getItem(RPANEL_STORE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return { w: clampRpanelWidth(p.w), open: p.open !== false };
  } catch {
    return fallback;
  }
}

/** Persist { w, open }; storage failures are silently ignored. */
export function saveRpanelPrefs(prefs, storage = defaultStorage()) {
  try {
    storage?.setItem(RPANEL_STORE_KEY, JSON.stringify({ w: clampRpanelWidth(prefs.w), open: prefs.open !== false }));
  } catch {
    /* sandboxed preview / quota — UI pref only, safe to drop */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire the right panel.
 *   els: { app, panel, divider, list, empty, detail, viewHost, viewTitle, closeBtn }
 *   opts: { registry, formatCoord, getCoordFmt, onSelect, onFlyTo, onOpenMenu,
 *           onEdit, onResize, views, onStatus }
 *
 * `views` is { key: { title, render(host) } } for the thin toolbar-driven
 * module views; 'objects' is the built-in default.
 */
export function createRightPanel(els, opts) {
  const { app, panel, divider } = els;
  const { registry, formatCoord, onResize, onStatus } = opts;

  let prefs = loadRpanelPrefs();
  let view = 'objects';
  let selectedId = null;

  const setWidthVar = (w) => {
    app.style.setProperty('--rpanel-w', `${w}px`);
    divider.setAttribute('aria-valuenow', String(w));
  };

  function applyOpen() {
    app.dataset.rpanel = prefs.open ? 'open' : 'closed';
    panel.setAttribute('aria-hidden', String(!prefs.open));
    onResize?.();
  }

  function setOpen(open) {
    prefs = { ...prefs, open };
    saveRpanelPrefs(prefs);
    applyOpen();
  }

  function setWidth(w, { persist = true } = {}) {
    const c = clampRpanelWidth(w);
    prefs = { ...prefs, w: c };
    setWidthVar(c);
    if (persist) saveRpanelPrefs(prefs);
    onResize?.();
  }

  // ── Divider: pointer-capture drag · double-click reset · arrow keys ─────
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', 'Resize object panel');
  divider.setAttribute('aria-valuemin', String(RPANEL_MIN_W));
  divider.setAttribute('aria-valuemax', String(RPANEL_MAX_W));
  divider.tabIndex = 0;

  let dragging = false;
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('is-dragging');
    e.preventDefault();
  });
  divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // The panel is the rightmost grid column: width = app right edge − cursor.
    const rect = app.getBoundingClientRect();
    setWidth(rect.right - e.clientX, { persist: false });
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('is-dragging');
    try { divider.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    saveRpanelPrefs(prefs);
  };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('dblclick', () => setWidth(RPANEL_DEFAULT_W));
  divider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(prefs.w + 16); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(prefs.w - 16); }
    else if (e.key === 'Home') { e.preventDefault(); setWidth(RPANEL_DEFAULT_W); }
  });

  // ── Views ────────────────────────────────────────────────────────────────
  function setView(next) {
    view = opts.views?.[next] ? next : 'objects';
    panel.dataset.rview = view;
    const v = view === 'objects' ? null : opts.views?.[view];
    els.viewTitle.textContent = v ? v.title : 'Objects';
    els.viewHost.hidden = !v;
    els.list.parentElement.hidden = Boolean(v);
    if (v) {
      els.viewHost.innerHTML = '';
      v.render(els.viewHost);
    } else {
      renderList();
    }
    opts.onViewChange?.(view);
  }

  // Esc inside the panel: non-default view → back to Objects.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && view !== 'objects') {
      e.stopPropagation();
      setView('objects');
    }
  });
  els.closeBtn.addEventListener('click', () => setOpen(false));

  // ── Objects list ────────────────────────────────────────────────────────
  function shortRef(e) {
    return formatCoord({ lat: e.lngLat[1], lng: e.lngLat[0] });
  }

  function renderList() {
    if (view !== 'objects') return;
    const all = registry.all();
    els.empty.hidden = all.length > 0;
    els.list.hidden = all.length === 0;
    els.list.innerHTML = '';
    for (const e of all) {
      const li = document.createElement('li');
      li.className = 'objrow';
      li.dataset.id = e.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.classList.toggle('is-selected', e.id === selectedId);
      const icon = document.createElement('span');
      icon.className = `objrow__icon objrow__icon--${e.kind}`;
      icon.innerHTML = objectIconSvg(e.kind);
      const name = document.createElement('span');
      name.className = 'objrow__name';
      name.textContent = e.name;
      name.title = e.name;
      const ref = document.createElement('span');
      ref.className = 'objrow__ref';
      ref.dataset.numeric = '';
      ref.textContent = shortRef(e);
      const kebab = document.createElement('button');
      kebab.type = 'button';
      kebab.className = 'objrow__menu';
      kebab.setAttribute('aria-label', `Options for ${e.name}`);
      kebab.title = 'Options';
      kebab.textContent = '⋮';
      kebab.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const r = kebab.getBoundingClientRect();
        opts.onOpenMenu?.(e.id, r.left, r.bottom + 4);
      });
      li.append(icon, name, ref, kebab);
      li.addEventListener('click', () => select(e.id));
      li.addEventListener('dblclick', () => opts.onFlyTo?.(e.id));
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') select(e.id);
      });
      li.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        opts.onOpenMenu?.(e.id, ev.clientX, ev.clientY);
      });
      els.list.appendChild(li);
    }
    renderDetail();
  }

  function select(id) {
    selectedId = registry.get(id) ? id : null;
    for (const li of els.list.children) {
      li.classList.toggle('is-selected', li.dataset.id === selectedId);
    }
    opts.onSelect?.(selectedId);
    renderDetail();
  }

  // ── Detail footer (selected object) ─────────────────────────────────────
  function renderDetail() {
    const e = selectedId ? registry.get(selectedId) : null;
    els.detail.hidden = !e;
    if (!e) return;
    els.detail.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'objdetail__head';
    head.innerHTML = `<strong></strong> <span class="objdetail__kind"></span>`;
    head.querySelector('strong').textContent = e.name;
    head.querySelector('.objdetail__kind').textContent = KIND_LABEL[e.kind] || e.kind;
    els.detail.appendChild(head);

    const pt = { lat: e.lngLat[1], lng: e.lngLat[0] };
    for (const fmt of ['latlng', 'mgrs', 'utm']) {
      const row = document.createElement('div');
      row.className = 'objdetail__coord';
      const val = document.createElement('span');
      val.dataset.numeric = '';
      val.textContent = formatCoord(pt, fmt);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'objdetail__copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        try {
          navigator.clipboard?.writeText(val.textContent);
          onStatus?.('Coordinate copied');
        } catch { /* clipboard unavailable */ }
      });
      row.append(val, copy);
      els.detail.appendChild(row);
    }

    if (RF_KINDS.includes(e.kind)) {
      const rf = document.createElement('div');
      rf.className = 'objdetail__rf';
      rf.dataset.numeric = '';
      rf.textContent = opts.rfSummary?.(e) ?? '';
      if (rf.textContent) els.detail.appendChild(rf);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn--sm objdetail__edit';
    edit.textContent = 'Edit';
    edit.title = 'Open the owning panel section';
    edit.addEventListener('click', () => opts.onEdit?.(e.id));
    els.detail.appendChild(edit);
  }

  // ── Registry events keep the list live ──────────────────────────────────
  document.addEventListener('objects:changed', (ev) => {
    if (ev.detail?.type === 'remove' && ev.detail.id === selectedId) selectedId = null;
    renderList();
  });

  // initial paint
  setWidthVar(prefs.w);
  applyOpen();
  setView('objects');

  return {
    setOpen,
    isOpen: () => prefs.open,
    toggle: () => setOpen(!prefs.open),
    setView,
    getView: () => view,
    select,
    getSelected: () => selectedId,
    refresh: renderList,
    getWidth: () => prefs.w,
  };
}
