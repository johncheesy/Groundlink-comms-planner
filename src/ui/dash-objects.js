/**
 * M21 §B — Objects focus dashboard: the full registry as a sortable table
 * (name, kind, grid ref, RF summary, status), row selection synced with the
 * map selection, bulk delete, and the M19 context menu on rows. Mounted by
 * the focus controller; re-renders on objects:changed while mounted.
 */
import { sortEntries } from './focus.js';
import { KIND_LABEL, RF_KINDS } from './objects.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COLS = [
  { key: 'name', label: 'Name' },
  { key: 'kindLabel', label: 'Kind' },
  { key: 'grid', label: 'Grid ref', numeric: true },
  { key: 'rf', label: 'RF' },
  { key: 'status', label: 'Status' },
];

export function createObjectsDash({ registry, formatCoord, rfSummary, onSelect, onFlyTo, onOpenMenu, onStatus }) {
  let host = null;
  let sortCol = 'name';
  let sortDir = 1;
  let selectedId = null;
  const checked = new Set();

  function rows() {
    return registry.all().map((e) => ({
      id: e.id,
      name: e.name,
      kindLabel: KIND_LABEL[e.kind] || e.kind,
      grid: formatCoord({ lat: e.lngLat[1], lng: e.lngLat[0] }),
      rf: RF_KINDS.includes(e.kind) ? rfSummary(e) : '—',
      status: e.locked ? 'Locked' : e.owner === 'recommend' ? 'Recommended' : 'Placed',
    }));
  }

  function render() {
    if (!host) return;
    const data = sortEntries(rows(), sortCol, sortDir);
    for (const id of [...checked]) if (!registry.get(id)) checked.delete(id);

    if (!data.length) {
      host.innerHTML =
        '<p class="help">No objects yet — place sites, demand points, waypoints or the drone and they appear here.</p>';
      return;
    }

    const head = COLS.map((c) => {
      const arrow = sortCol === c.key ? (sortDir > 0 ? ' ↑' : ' ↓') : '';
      return `<th><button type="button" class="objdash__sort" data-col="${c.key}" aria-label="Sort by ${c.label}">${c.label}${arrow}</button></th>`;
    }).join('');

    const body = data
      .map(
        (r) =>
          `<tr data-id="${esc(r.id)}" class="${r.id === selectedId ? 'is-selected' : ''}">` +
          `<td class="objdash__check"><input type="checkbox" aria-label="Select ${esc(r.name)}" ${checked.has(r.id) ? 'checked' : ''} /></td>` +
          `<td class="objdash__name">${esc(r.name)}</td>` +
          `<td>${esc(r.kindLabel)}</td>` +
          `<td data-numeric>${esc(r.grid)}</td>` +
          `<td class="objdash__rf" data-numeric>${esc(r.rf)}</td>` +
          `<td class="objdash__status">${esc(r.status)}</td>` +
          `<td class="objdash__menu"><button type="button" class="objdash__more" aria-label="Actions for ${esc(r.name)}">⋯</button></td>` +
          `</tr>`,
      )
      .join('');

    host.innerHTML =
      `<div class="objdash__bar">` +
      `<span class="objdash__count" data-numeric>${data.length} object${data.length === 1 ? '' : 's'}</span>` +
      `<button type="button" class="btn btn--sm objdash__delsel" ${checked.size ? '' : 'disabled'}>Delete selected${checked.size ? ` (${checked.size})` : ''}</button>` +
      `</div>` +
      `<div class="objdash__scroll"><table class="objdash__table">` +
      `<thead><tr><th class="objdash__check"></th>${head}<th></th></tr></thead>` +
      `<tbody>${body}</tbody></table></div>` +
      `<p class="help">Click a row to select it on the map · double-click to fly to it · right-click (or ⋯) for actions.</p>`;
  }

  function onChanged() {
    render();
  }

  function rowId(target) {
    return target.closest('tr[data-id]')?.dataset.id ?? null;
  }

  function handleClick(e) {
    const sortBtn = e.target.closest('.objdash__sort');
    if (sortBtn) {
      const col = sortBtn.dataset.col;
      sortDir = sortCol === col ? -sortDir : 1;
      sortCol = col;
      render();
      return;
    }
    if (e.target.closest('.objdash__delsel')) {
      const n = checked.size;
      for (const id of [...checked]) registry.remove(id);
      checked.clear();
      onStatus?.(`Deleted ${n} object${n === 1 ? '' : 's'}`);
      return;
    }
    const id = rowId(e.target);
    if (!id) return;
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.checked ? checked.add(id) : checked.delete(id);
      render();
      return;
    }
    if (e.target.closest('.objdash__more')) {
      const rect = e.target.getBoundingClientRect();
      onOpenMenu?.(id, rect.left, rect.bottom + 4);
      return;
    }
    selectedId = id;
    onSelect?.(id);
    render();
  }

  function handleDblClick(e) {
    const id = rowId(e.target);
    if (id) onFlyTo?.(id);
  }

  function handleContext(e) {
    const id = rowId(e.target);
    if (!id) return;
    e.preventDefault();
    onOpenMenu?.(id, e.clientX, e.clientY);
  }

  return {
    replace: true, // hide the portalled section's simple list while mounted
    mount(el) {
      host = el;
      host.classList.add('objdash');
      host.addEventListener('click', handleClick);
      host.addEventListener('dblclick', handleDblClick);
      host.addEventListener('contextmenu', handleContext);
      document.addEventListener('objects:changed', onChanged);
      render();
    },
    unmount() {
      document.removeEventListener('objects:changed', onChanged);
      host = null;
      selectedId = null;
      checked.clear();
    },
  };
}
