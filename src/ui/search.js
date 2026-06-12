import maplibregl from 'maplibre-gl';
import { parseCoordinate } from '../geo/coords.js';
import { rankPalette } from './palette.js';

/**
 * M20 §4 — command palette (⌘K / Ctrl-K), grown from the M2 map search box
 * (which it replaces: one entry point).
 *
 * Sections, ranked by palette.js: Objects (registry: select/flyTo), Actions
 * (the same handlers the UI already has), Go to (coordinate entry in any
 * supported format + Nominatim place search), Tabs (open by label).
 *
 * Coordinates fly straight there and drop a temporary pin. Free text geocodes
 * via Photon (photon.komoot.io — OSM data, token-free, built for as-you-type
 * prefix search; Nominatim's /search endpoint cannot autocomplete, see
 * docs/M23-fixes.md §1) — min 3 chars, 300 ms debounce, capped at 5; results
 * append to the Go-to section while the user types. No state persists.
 *
 * Keyboard: ⌘K/Ctrl-K toggles; ↑↓ move, Enter runs, Esc closes and returns
 * focus to the map. role="dialog" + listbox semantics; outside click closes.
 */

const PHOTON = 'https://photon.komoot.io/api/';
const GEOCODE_MIN_CHARS = 3;
const GEOCODE_DEBOUNCE_MS = 300;

/**
 * Map a Photon GeoJSON response to the Nominatim-style places the palette
 * renders: { display_name, lat, lon, boundingbox }. Pure (unit-tested).
 * Photon extent is [west, north, east, south]; Nominatim boundingbox is
 * [south, north, west, east].
 */
export function photonToPlaces(geojson) {
  const places = [];
  for (const f of geojson?.features ?? []) {
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties ?? {};
    const display_name = [p.name, p.city, p.state ?? p.county, p.country]
      .filter((part, i, all) => part && all.indexOf(part) === i)
      .join(', ');
    if (!display_name) continue;
    const e = p.extent;
    const boundingbox =
      Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)
        ? [e[3], e[1], e[0], e[2]]
        : undefined;
    places.push({ display_name, lat, lon, boundingbox });
  }
  return places;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/**
 * providers: [{ key, title, getItems() → [{ label, keywords?, hint?, run() }] }]
 * in display order (objects, actions, tabs). "Go to" is built in.
 */
export function createPalette(map, { providers = [], onStatus } = {}) {
  let pin = null;
  let debounce = 0;
  let lastQuery = '';
  let places = []; // async Nominatim results for the current query
  let flat = []; // rendered items in visual order
  let activeIndex = -1;
  let isOpen = false;

  // ── Overlay DOM ──────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'palette';
  root.hidden = true;
  root.innerHTML =
    '<div class="palette__scrim"></div>' +
    '<div class="palette__panel" role="dialog" aria-modal="true" aria-label="Command palette">' +
    '<form class="palette__form" role="search" autocomplete="off">' +
    '<svg class="palette__ico ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>' +
    '<input class="palette__input" id="paletteInput" type="text" ' +
    'placeholder="Search objects, actions, tabs, places — or lat/long · MGRS · UTM" ' +
    'aria-label="Search objects, actions, tabs, places, or enter coordinates" ' +
    'role="combobox" aria-expanded="true" aria-controls="paletteList" />' +
    '<kbd class="palette__kbd" aria-hidden="true">esc</kbd>' +
    '</form>' +
    '<ul class="palette__list" id="paletteList" role="listbox"></ul>' +
    '</div>';
  document.body.appendChild(root);

  const input = root.querySelector('.palette__input');
  const list = root.querySelector('.palette__list');
  const form = root.querySelector('.palette__form');

  // ── Map helpers (kept from the M2 search box) ────────────────────────────
  function dropPin(lng, lat) {
    if (pin) pin.remove();
    const el = document.createElement('div');
    el.className = 'search-pin';
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2" fill="currentColor" stroke="none"/></svg>';
    pin = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
  }

  function flyTo(lng, lat, bbox) {
    if (Array.isArray(bbox) && bbox.length === 4) {
      // Nominatim bbox = [south, north, west, east] as strings.
      const [s, n, w, e] = bbox.map(Number);
      if ([s, n, w, e].every(Number.isFinite)) {
        map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16, duration: 800 });
        return;
      }
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
  }

  // ── Sections → flat render ───────────────────────────────────────────────
  function gotoItems(q) {
    const items = [];
    const point = q ? parseCoordinate(q) : null;
    if (point) {
      items.push({
        label: `Go to ${q}`,
        hint: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
        run() {
          dropPin(point.lng, point.lat);
          flyTo(point.lng, point.lat);
          onStatus?.(`Centred on ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
        },
      });
    }
    for (const r of places) {
      const lng = Number(r.lon);
      const lat = Number(r.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      items.push({
        label: r.display_name,
        hint: 'place',
        run() {
          dropPin(lng, lat);
          flyTo(lng, lat, r.boundingbox);
          onStatus?.(`Found “${r.display_name.split(',')[0]}”`);
        },
      });
    }
    return items;
  }

  function render() {
    const q = input.value.trim();
    const ranked = rankPalette(
      q,
      providers.map((p) => ({ key: p.key, title: p.title, items: p.getItems() })),
    );
    // A parsed coordinate replaces everything (rankPalette short-circuits the
    // same way when given the parser; we keep goto async so build it here).
    const goto = gotoItems(q);
    const sections = parseCoordinate(q)
      ? [{ key: 'goto', title: 'Go to', items: goto }]
      : goto.length
        ? [...ranked, { key: 'goto', title: 'Go to', items: goto }]
        : ranked;

    flat = [];
    let html = '';
    for (const s of sections) {
      html += `<li class="palette__section" role="presentation">${escapeHtml(s.title)}</li>`;
      for (const item of s.items) {
        const i = flat.length;
        flat.push(item);
        html +=
          `<li class="palette__item" role="option" id="palette-item-${i}" data-i="${i}" aria-selected="false">` +
          `<span class="palette__item-label">${escapeHtml(item.label)}</span>` +
          (item.hint ? `<span class="palette__item-hint">${escapeHtml(item.hint)}</span>` : '') +
          '</li>';
      }
    }
    if (!flat.length) {
      html += `<li class="palette__empty">${q ? 'No matches' : 'Type to search'}</li>`;
    }
    list.innerHTML = html;
    setActive(flat.length ? 0 : -1);
  }

  function setActive(i) {
    activeIndex = i;
    list.querySelectorAll('.palette__item').forEach((li) => {
      const on = Number(li.dataset.i) === i;
      li.classList.toggle('is-active', on);
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', `palette-item-${i}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    const item = flat[i];
    if (!item) return;
    close();
    item.run?.();
  }

  // ── Photon typeahead (gentle: min chars, debounced, 5 results) ──────────
  async function geocode(q) {
    try {
      onStatus?.('Searching…');
      const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=5`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      const found = photonToPlaces(await res.json());
      if (q !== lastQuery || !isOpen) return; // superseded or closed meanwhile
      places = found;
      render();
      onStatus?.(found.length ? `${found.length} match${found.length > 1 ? 'es' : ''}` : 'No matches');
    } catch (err) {
      console.warn('[palette] geocode failed', err);
      onStatus?.('Place search unavailable');
    }
  }

  // ── Open / close ─────────────────────────────────────────────────────────
  function open() {
    if (isOpen) return;
    isOpen = true;
    root.hidden = false;
    input.value = '';
    places = [];
    render();
    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    window.clearTimeout(debounce);
    places = [];
    // Esc / pick returns focus to the map (acceptance: keyboard round-trip).
    map.getCanvas()?.focus?.();
  }

  // ── Events ───────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (isOpen) close();
      else open();
    } else if (e.key === 'Escape' && isOpen) {
      e.stopPropagation(); // the profile tool's Esc handler must not also fire
      close();
    }
  }, true);

  root.querySelector('.palette__scrim').addEventListener('click', close);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    places = [];
    render();
    window.clearTimeout(debounce);
    // Coordinates never hit the network; short fragments wait for more input.
    if (q.length < GEOCODE_MIN_CHARS || parseCoordinate(q)) return;
    debounce = window.setTimeout(() => {
      lastQuery = q;
      geocode(q);
    }, GEOCODE_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + dir + flat.length) % flat.length);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (activeIndex >= 0) pick(activeIndex);
  });

  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('[data-i]');
    if (li && Number(li.dataset.i) !== activeIndex) setActive(Number(li.dataset.i));
  });

  return {
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    clearPin() {
      if (pin) {
        pin.remove();
        pin = null;
      }
    },
  };
}
