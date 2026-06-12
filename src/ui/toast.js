/**
 * M23 §3 — minimal toast: one reusable chip over the map for transient
 * notices the status bar is too quiet for (e.g. "Location not available").
 * Single element, aria-live="polite", auto-hides; design tokens only.
 */

const HIDE_AFTER_MS = 3500;

let el = null;
let hideTimer = 0;

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'gl-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

/** Show a short transient message; repeated calls restart the timer. */
export function showToast(message) {
  const t = ensureEl();
  t.textContent = message;
  t.hidden = false;
  // Restart the slide-in transition when already visible.
  t.classList.remove('gl-toast--in');
  void t.offsetWidth;
  t.classList.add('gl-toast--in');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    t.classList.remove('gl-toast--in');
    t.hidden = true;
  }, HIDE_AFTER_MS);
}
