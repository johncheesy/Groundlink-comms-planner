import maplibregl from 'maplibre-gl';
import { parseCoordinate } from '../geo/coords.js';

/**
 * Location search + coordinate entry, sitting over the map.
 *
 * Two input modes, picked from the text the user types:
 *  - a coordinate in any supported format — decimal lat/long, DMS, MGRS or UTM
 *    (parseCoordinate) — flies straight there and drops a temporary pin;
 *  - free text geocodes via Nominatim (OpenStreetMap, token-free) and lists up
 *    to five matches; picking one flies to it (to its bbox when supplied).
 *
 * Nominatim asks callers to be gentle: we debounce, cap at 5 results, and only
 * query on a settled input. No state is persisted.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Recognise any supported coordinate grammar; null → treat as a place name.
const parseCoords = (text) => parseCoordinate(text);

export function createSearch(map, { input, form, results, clearBtn, onStatus } = {}) {
  let pin = null;
  let debounce = 0;
  let lastQuery = '';
  let activeIndex = -1;
  let items = [];

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

  function hideResults() {
    results.hidden = true;
    results.innerHTML = '';
    items = [];
    activeIndex = -1;
  }

  function showResults(list) {
    items = list;
    activeIndex = -1;
    if (!list.length) {
      results.innerHTML = '<li class="map-search__empty">No matches</li>';
      results.hidden = false;
      return;
    }
    results.innerHTML = list
      .map(
        (r, i) =>
          `<li class="map-search__result" role="option" data-i="${i}" tabindex="-1">${escapeHtml(
            r.display_name
          )}</li>`
      )
      .join('');
    results.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function pick(r) {
    const lng = Number(r.lon);
    const lat = Number(r.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    dropPin(lng, lat);
    flyTo(lng, lat, r.boundingbox);
    hideResults();
    input.value = r.display_name.split(',').slice(0, 2).join(',');
    clearBtn.hidden = false;
    onStatus?.(`Found “${input.value}”`);
  }

  async function geocode(q) {
    try {
      onStatus?.('Searching…');
      const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=0`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const list = await res.json();
      if (q !== lastQuery) return; // a newer query superseded this one
      showResults(list);
      onStatus?.(list.length ? `${list.length} match${list.length > 1 ? 'es' : ''}` : 'No matches');
    } catch (err) {
      console.warn('[search] geocode failed', err);
      showResults([]);
      onStatus?.('Search unavailable');
    }
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    const coords = parseCoords(text);
    if (coords) {
      dropPin(coords.lng, coords.lat);
      flyTo(coords.lng, coords.lat);
      hideResults();
      clearBtn.hidden = false;
      onStatus?.(`Centred on ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
      return;
    }
    lastQuery = text;
    geocode(text);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (activeIndex >= 0 && items[activeIndex]) pick(items[activeIndex]);
    else submit();
  });

  input.addEventListener('input', () => {
    const text = input.value.trim();
    clearBtn.hidden = !text;
    window.clearTimeout(debounce);
    if (!text || parseCoords(text)) {
      hideResults();
      return;
    }
    debounce = window.setTimeout(() => {
      lastQuery = text;
      geocode(text);
    }, 350);
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + dir + items.length) % items.length;
      results.querySelectorAll('.map-search__result').forEach((li, i) =>
        li.classList.toggle('is-active', i === activeIndex)
      );
    } else if (e.key === 'Escape') {
      hideResults();
    }
  });

  results.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    pick(items[Number(li.dataset.i)]);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    hideResults();
    if (pin) {
      pin.remove();
      pin = null;
    }
    input.focus();
  });

  // Click elsewhere closes the result list.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-search')) hideResults();
  });

  return {
    clearPin() {
      if (pin) {
        pin.remove();
        pin = null;
      }
    },
  };
}
