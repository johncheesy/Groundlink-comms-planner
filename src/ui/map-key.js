/**
 * Compact colour key on the map for the active coverage view (UI test U7):
 * the signal scale, the best-server zones or the C/I bands, next to the
 * colours they explain instead of down the side panel.
 *
 * Rows: [{ color, label, value? }] plus an optional footnote. Colours are CSS
 * values (tokens or resolved rgb), labels plain text.
 */

import { esc as htmlEsc } from '../util/esc.js';

export function createMapKey(container) {
  const el = document.createElement('div');
  el.className = 'map-key';
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'Map colour key');
  el.hidden = true;
  container.appendChild(el);

  return {
    /** Show `title` with rows; hides when there are no rows. */
    show({ title, rows = [], note = '' }) {
      if (!rows.length) {
        el.hidden = true;
        return;
      }
      el.innerHTML =
        `<div class="map-key__title">${htmlEsc(title)}</div>` +
        rows.map((r) =>
          `<div class="map-key__row"><i class="map-key__swatch" style="background:${r.color}"></i>` +
          `<span>${htmlEsc(r.label)}</span>${r.value ? `<b data-numeric>${htmlEsc(r.value)}</b>` : ''}</div>`).join('') +
        (note ? `<div class="map-key__note">${htmlEsc(note)}</div>` : '');
      el.hidden = false;
    },
    hide() { el.hidden = true; },
    el,
  };
}
