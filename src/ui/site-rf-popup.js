/**
 * Per-site mast height and power (M50) — a small popover at the site, from
 * the site's context menu. Empty fields mean "follow the Coverage panel";
 * the panel's values show as placeholders so the default is never hidden.
 */

import maplibregl from 'maplibre-gl';
import { SITE_RF_LIMITS } from '../mission/mission.js';

/**
 * Read the two fields. Empty → null (follow the panel); out of range is
 * clamped; anything unreadable → an error string.
 * @returns {{ txHeightM:number|null, powerW:number|null } | { error:string }}
 */
export function parseSiteRf(heightText, powerText) {
  const read = (text, [lo, hi], what) => {
    const t = String(text ?? '').trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return { error: `${what} is not a number` };
    return Math.min(hi, Math.max(lo, n));
  };
  const txHeightM = read(heightText, SITE_RF_LIMITS.txHeightM, 'Mast height');
  if (txHeightM?.error) return txHeightM;
  const powerW = read(powerText, SITE_RF_LIMITS.powerW, 'Power');
  if (powerW?.error) return powerW;
  return { txHeightM, powerW };
}

let open = null;

/**
 * @param {maplibregl.Map} map
 * @param {object} o
 * @param {[number, number]} o.lngLat
 * @param {string} o.name
 * @param {{txHeightM:number|null, powerW:number|null}} o.current  site's own values
 * @param {{txHeightM:number, powerW:number}} o.panel             Coverage panel values
 * @param {(v:{txHeightM:number|null, powerW:number|null}) => void} o.onSave
 */
export function openSiteRfPopup(map, { lngLat, name, current, panel, onSave }) {
  open?.remove();
  const wrap = document.createElement('form');
  wrap.className = 'site-rf';
  wrap.innerHTML =
    `<div class="site-rf__title"></div>` +
    `<label class="field-label">Mast height<span class="input-row">` +
    `<input class="input input--mini" name="h" type="text" inputmode="decimal" autocomplete="off" /><span class="input-suffix">m</span></span></label>` +
    `<label class="field-label">Power<span class="input-row">` +
    `<input class="input input--mini" name="p" type="text" inputmode="decimal" autocomplete="off" /><span class="input-suffix">W</span></span></label>` +
    `<p class="help site-rf__hint">Empty = the Coverage panel value.</p>` +
    `<p class="help site-rf__err" role="alert" hidden></p>` +
    `<div class="site-rf__actions">` +
    `<button class="btn btn--sm" type="button" data-act="reset">Use panel values</button>` +
    `<button class="btn btn--sm btn--primary" type="submit">Save</button></div>`;
  wrap.querySelector('.site-rf__title').textContent = name || 'Site';
  const h = wrap.querySelector('[name="h"]');
  const p = wrap.querySelector('[name="p"]');
  h.value = current.txHeightM ?? '';
  p.value = current.powerW ?? '';
  h.placeholder = String(panel.txHeightM);
  p.placeholder = String(panel.powerW);
  const err = wrap.querySelector('.site-rf__err');

  const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 16, className: 'site-rf-popup' })
    .setLngLat(lngLat)
    .setDOMContent(wrap)
    .addTo(map);
  open = popup;
  popup.on('close', () => { if (open === popup) open = null; });

  const save = (v) => { onSave(v); popup.remove(); };
  wrap.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseSiteRf(h.value, p.value);
    if (v.error) {
      err.textContent = v.error;
      err.hidden = false;
      return;
    }
    save(v);
  });
  wrap.querySelector('[data-act="reset"]').addEventListener('click', () => save({ txHeightM: null, powerW: null }));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') popup.remove(); });
  h.focus();
  return popup;
}
