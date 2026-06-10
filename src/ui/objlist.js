/**
 * M19 (rev 2) — the Objects tab in the left panel: registry list + detail.
 *
 * Renders one row per placed object (kind icon · name · grid ref in the
 * active coordinate format · kebab menu) and, for the selected object, a
 * detail block with copyable coords in all three formats, the key RF line
 * and an Edit jump to the owning section. Stays live via the registry's
 * `objects:changed` events.
 */
import { KIND_LABEL, RF_KINDS } from './objects.js';
import { objectIconSvg } from './icons.js';

/**
 * els:  { list, empty, detail }
 * opts: { registry, formatCoord(pt, fmt?), onOpenMenu(id, x, y), onFlyTo(id),
 *         onSelect(id|null), onEdit(id), rfSummary(entry), onStatus(msg) }
 */
export function createObjectList(els, opts) {
  const { registry, formatCoord, onStatus } = opts;
  let selectedId = null;

  function renderList() {
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
      ref.textContent = formatCoord({ lat: e.lngLat[1], lng: e.lngLat[0] });
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

  document.addEventListener('objects:changed', (ev) => {
    if (ev.detail?.type === 'remove' && ev.detail.id === selectedId) selectedId = null;
    renderList();
  });
  renderList();

  return { refresh: renderList, select, getSelected: () => selectedId };
}
