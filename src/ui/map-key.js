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
    /**
     * `warn` ({ text, action, onAction }) puts an amber line above the rows —
     * used for "defaults in use", which must be visible next to the colours
     * it explains rather than only in a card or a tooltip.
     */
    show({ title, rows = [], note = '', warn = null }) {
      if (!rows.length) {
        el.hidden = true;
        return;
      }
      el.innerHTML =
        (warn
          ? `<button type="button" class="map-key__warn" title="${htmlEsc(warn.title ?? warn.text)}">⚠ ${htmlEsc(warn.text)}` +
            (warn.action ? ` <u>${htmlEsc(warn.action)}</u>` : '') + `</button>`
          : '') +
        `<div class="map-key__title">${htmlEsc(title)}</div>` +
        rows.map((r) =>
          `<div class="map-key__row"><i class="map-key__swatch" style="background:${r.color}"></i>` +
          `<span>${htmlEsc(r.label)}</span>${r.value ? `<b data-numeric>${htmlEsc(r.value)}</b>` : ''}</div>`).join('') +
        (note ? `<div class="map-key__note">${htmlEsc(note)}</div>` : '');
      if (warn?.onAction) el.querySelector('.map-key__warn')?.addEventListener('click', warn.onAction);
      el.hidden = false;
    },
    hide() { el.hidden = true; },
    el,
  };
}
