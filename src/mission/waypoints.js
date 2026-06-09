import maplibregl from 'maplibre-gl';

/**
 * Named map locations (M11) — click-to-place waypoints the user can name, tag
 * with an icon, and click to read elevation + coordinates in three families.
 *
 * Each waypoint: { id, name, lat, lng, icon, altM|null, marker }. The marker is
 * a MapLibre DOM marker (a small azure circle with an inline icon). Clicking a
 * marker opens an info popup with an inline-editable name, the coordinate in
 * lat/long · MGRS · UTM (each copyable), the terrain elevation, an icon picker
 * and a delete button. Placing first shows a small creation form (name + icon).
 *
 * Pure in-memory state — nothing is persisted (OPSEC / sandboxed-preview rules).
 */

export const WP_ICONS = ['point', 'person', 'antenna', 'vehicle', 'checkpoint', 'observer', 'hq'];

// Default marker colour — the CELL_TYPE_DEFAULTS azure (assets / tracks).
const AZURE = getComputedStyle(document.documentElement).getPropertyValue('--feat-track').trim() || '#46a6ff';

/** Human label for a coordinate family key (matches COORD_CYCLE values). */
const FMT_LABEL = { latlng: 'Lat/Long', dms: 'DMS', mgrs: 'MGRS', utm: 'UTM' };

/**
 * Inline icon glyph for a waypoint type, stroke/fill in `c`. 16×16 viewBox,
 * simple geometric paths so they read at marker size (12 px) and in the picker.
 */
function iconSvg(name, c = 'currentColor') {
  const s = `stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let body;
  switch (name) {
    case 'person':
      body = `<circle cx="8" cy="5.3" r="2.4" ${s}/><path d="M3.6 13.5c0-2.5 2-4 4.4-4s4.4 1.5 4.4 4" ${s}/>`;
      break;
    case 'antenna':
      body = `<path d="M8 2.5v11M8 6l-3 7.5M8 6l3 7.5M5.6 9.6h4.8" ${s}/>`;
      break;
    case 'vehicle':
      body = `<path d="M2.5 11h11M3.6 11V8l1.9-2.5h5L12.4 8v3" ${s}/><circle cx="5.6" cy="12" r="1" ${s}/><circle cx="10.4" cy="12" r="1" ${s}/>`;
      break;
    case 'checkpoint':
      body = `<path d="M4.6 2.5v11" ${s}/><path d="M4.6 3.4h6.6L9.6 5.6l1.6 2.2H4.6z" ${s}/>`;
      break;
    case 'observer':
      body = `<path d="M1.8 8S4.4 4.3 8 4.3 14.2 8 14.2 8 11.6 11.7 8 11.7 1.8 8 1.8 8z" ${s}/><circle cx="8" cy="8" r="1.7" fill="${c}" stroke="none"/>`;
      break;
    case 'hq':
      body = `<path d="M3 7.5L8 3.5l5 4M4.6 7v6.4h6.8V7" ${s}/>`;
      break;
    case 'point':
    default:
      body = `<circle cx="8" cy="8" r="3.2" fill="${c}" stroke="none"/>`;
      break;
  }
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

export function createWaypointController(map, { onUpdate, formatCoord, coordCycle } = {}) {
  const waypoints = [];
  let nextId = 1;
  let placing = false; // are we in click-to-place mode?
  let infoPopup = null;
  let formPopup = null;

  const fmts = coordCycle && coordCycle.length ? coordCycle : ['latlng', 'mgrs', 'utm'];

  // ── Elevation ───────────────────────────────────────────────────────────
  function elevationAt(lng, lat) {
    try {
      const e = map.queryTerrainElevation([lng, lat], { exaggerated: false });
      return Number.isFinite(e) ? e : null;
    } catch {
      return null; // terrain source not loaded
    }
  }
  const fmtElev = (m) => (m == null ? '▲ unknown' : `▲ ${Math.round(m)} m`);

  // ── Marker element ──────────────────────────────────────────────────────
  function makeMarkerEl(icon) {
    const el = document.createElement('div');
    el.className = `wp-marker wp-icon--${icon}`;
    el.innerHTML = iconSvg(icon, '#fff');
    return el;
  }
  function setMarkerIcon(wp) {
    const el = wp.marker.getElement();
    el.className = `wp-marker wp-icon--${wp.icon}`;
    el.innerHTML = iconSvg(wp.icon, '#fff');
  }

  // ── Icon picker (shared by creation form + info popup) ──────────────────
  function buildIconPicker(current, onPick) {
    const row = document.createElement('div');
    row.className = 'wp-icon-picker';
    const buttons = [];
    WP_ICONS.forEach((icon) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wp-icon-btn' + (icon === current ? ' is-active' : '');
      btn.title = icon;
      btn.innerHTML = iconSvg(icon, 'currentColor');
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        onPick(icon);
      });
      buttons.push(btn);
      row.appendChild(btn);
    });
    return row;
  }

  // ── Info popup (click an existing marker) ───────────────────────────────
  function openInfoPopup(wp) {
    closeInfoPopup();
    const wrap = document.createElement('div');
    wrap.className = 'wp-popup';

    // Name — inline editable (click to edit, blur/Enter saves).
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'wp-popup-name';
    name.value = wp.name;
    name.setAttribute('aria-label', 'Waypoint name');
    const saveName = () => {
      const v = name.value.trim();
      wp.name = v || wp.name;
      name.value = wp.name;
      wp.marker.getElement().title = wp.name;
      onUpdate?.(getAll());
    };
    name.addEventListener('change', saveName);
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); saveName(); name.blur(); }
    });
    wrap.appendChild(name);

    // Coordinates — one row per family, each copyable.
    const pt = { lat: wp.lat, lng: wp.lng };
    for (const fmt of fmts) {
      const text = formatCoord ? formatCoord(pt, fmt) : `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;
      const rowEl = document.createElement('div');
      rowEl.className = 'wp-coord-row';
      const val = document.createElement('span');
      val.dataset.numeric = '';
      val.textContent = `${FMT_LABEL[fmt] || fmt}: ${text}`;
      val.style.flex = '1 1 auto';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'wp-coord-copy';
      copy.textContent = 'Copy';
      copy.title = 'Copy coordinate';
      copy.addEventListener('click', () => {
        try { navigator.clipboard?.writeText(text); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); } catch { /* clipboard unavailable */ }
      });
      rowEl.appendChild(val);
      rowEl.appendChild(copy);
      wrap.appendChild(rowEl);
    }

    // Elevation — from altM if known, else query at open time.
    const elev = document.createElement('div');
    elev.className = 'wp-elev';
    elev.dataset.numeric = '';
    const altNow = wp.altM != null ? wp.altM : elevationAt(wp.lng, wp.lat);
    if (wp.altM == null && altNow != null) wp.altM = altNow;
    elev.textContent = fmtElev(altNow);
    wrap.appendChild(elev);

    // Icon picker.
    wrap.appendChild(buildIconPicker(wp.icon, (icon) => {
      wp.icon = icon;
      setMarkerIcon(wp);
      onUpdate?.(getAll());
    }));

    // Delete.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'wp-delete';
    del.textContent = 'Delete waypoint';
    del.addEventListener('click', () => { closeInfoPopup(); remove(wp.id); });
    wrap.appendChild(del);

    infoPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 14 })
      .setLngLat([wp.lng, wp.lat])
      .setDOMContent(wrap)
      .addTo(map);
  }
  function closeInfoPopup() { infoPopup?.remove(); infoPopup = null; }

  // ── Creation form (after click-to-place) ────────────────────────────────
  function openCreationForm(lat, lng) {
    closeForm();
    let icon = 'point';
    const wrap = document.createElement('div');
    wrap.className = 'wp-popup wp-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wp-popup-name';
    input.value = `WP ${nextId}`;
    input.setAttribute('aria-label', 'Waypoint name');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { closeForm(); }
    });
    wrap.appendChild(input);

    wrap.appendChild(buildIconPicker(icon, (i) => { icon = i; }));

    const btns = document.createElement('div');
    btns.className = 'wp-form-btns';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--sm wp-form-add';
    add.textContent = 'Add';
    add.addEventListener('click', commit);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--sm';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => closeForm());
    btns.appendChild(add);
    btns.appendChild(cancel);
    wrap.appendChild(btns);

    function commit() {
      const wp = addWaypoint(lat, lng, input.value.trim() || `WP ${nextId}`, icon);
      closeForm();
      openInfoPopup(wp);
    }

    formPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 14 })
      .setLngLat([lng, lat])
      .setDOMContent(wrap)
      .addTo(map);
    // Focus the name so the user can rename immediately.
    setTimeout(() => { try { input.focus(); input.select(); } catch { /* not focusable yet */ } }, 0);
  }
  function closeForm() { formPopup?.remove(); formPopup = null; }

  // ── Create a waypoint + its marker ──────────────────────────────────────
  function addWaypoint(lat, lng, name, icon) {
    const wp = {
      id: nextId++,
      name: name || `WP ${nextId}`,
      lat,
      lng,
      icon: WP_ICONS.includes(icon) ? icon : 'point',
      altM: elevationAt(lng, lat),
    };
    const marker = new maplibregl.Marker({ element: makeMarkerEl(wp.icon) })
      .setLngLat([lng, lat])
      .addTo(map);
    marker.getElement().title = wp.name;
    marker.getElement().addEventListener('click', (ev) => {
      ev.stopPropagation();
      openInfoPopup(wp);
    });
    wp.marker = marker;
    waypoints.push(wp);
    onUpdate?.(getAll());
    return wp;
  }

  // ── Click-to-place ──────────────────────────────────────────────────────
  function onPlace(e) {
    placing = false;
    map.getCanvas().style.cursor = '';
    openCreationForm(e.lngLat.lat, e.lngLat.lng);
  }
  function startPlacing() {
    if (placing) return;
    placing = true;
    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', onPlace);
  }
  function cancelPlacing() {
    if (!placing) return;
    placing = false;
    map.getCanvas().style.cursor = '';
    map.off('click', onPlace);
  }

  // ── Removal + accessors ─────────────────────────────────────────────────
  function remove(id) {
    const i = waypoints.findIndex((w) => w.id === id);
    if (i === -1) return;
    waypoints[i].marker?.remove();
    waypoints.splice(i, 1);
    onUpdate?.(getAll());
  }
  function getAll() {
    return waypoints.map(({ id, name, lat, lng, icon, altM }) => ({ id, name, lat, lng, icon, altM }));
  }

  return { startPlacing, cancelPlacing, remove, getAll, isPlacing: () => placing };
}
