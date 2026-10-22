/**
 * Persistent map notice — a small bar over the map for conditions the user must
 * understand and may act on (e.g. "satellite imagery is unreachable, switched
 * to X"). Unlike the toast it stays until dismissed or replaced, and carries
 * action buttons. One instance, aria-live="polite", design tokens only.
 */

/**
 * @param {HTMLElement} host   container the bar is positioned in (the map wrap)
 * @returns {{ show(o:{message:string, tone?:'info'|'warn', actions?:Array<{label:string,onClick:Function}>}):void, hide():void, isVisible():boolean }}
 */
export function createMapNotice(host) {
  let el = null;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'map-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    host.appendChild(el);
    return el;
  }

  return {
    show({ message, tone = 'warn', actions = [] }) {
      const root = ensure();
      root.className = `map-notice map-notice--${tone}`;
      root.textContent = '';

      const text = document.createElement('span');
      text.className = 'map-notice__text';
      text.textContent = message; // textContent: provider labels are data, never HTML
      root.appendChild(text);

      const row = document.createElement('span');
      row.className = 'map-notice__actions';
      for (const a of actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--sm';
        b.textContent = a.label;
        b.addEventListener('click', () => a.onClick?.());
        row.appendChild(b);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'map-notice__close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => { root.hidden = true; });
      row.appendChild(close);
      root.appendChild(row);

      root.hidden = false;
    },
    hide() { if (el) el.hidden = true; },
    isVisible() { return !!el && !el.hidden; },
  };
}
