/**
 * In-app confirm dialog — replaces window.confirm, which embedded previews,
 * sandboxed frames and some installed-app shells auto-dismiss (the caller then
 * sees a silent "cancel"). Same card as the save-mission dialog (.msave).
 *
 *   if (await confirmDialog({ title, message, confirmLabel })) { … }
 *
 * Resolves true on confirm, false on cancel / Esc / backdrop click. One dialog
 * at a time: a second call while open resolves the first as cancelled.
 */

let open = null; // { root, finish }

export function confirmDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
  open?.finish(false);
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'msave';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      `<div class="msave__card">` +
      `<h2 class="msave__title"></h2>` +
      `<p class="msave__warn"></p>` +
      `<div class="msave__actions">` +
      `<button class="btn" type="button" data-act="cancel"></button>` +
      `<button class="btn btn--primary" type="button" data-act="ok"></button>` +
      `</div></div>`;
    root.querySelector('.msave__title').textContent = title ?? '';
    root.querySelector('.msave__warn').textContent = message;
    root.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    root.querySelector('[data-act="ok"]').textContent = confirmLabel;
    root.setAttribute('aria-label', title ?? confirmLabel);
    const prevFocus = document.activeElement;

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(false);
    };
    function finish(ok) {
      if (open?.root !== root) return;
      open = null;
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      prevFocus?.focus?.();
      resolve(ok);
    }

    root.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
    root.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
    root.addEventListener('click', (e) => { if (e.target === root) finish(false); });
    // Capture phase: Esc here must win over focus mode / panel handlers.
    document.addEventListener('keydown', onKey, true);

    open = { root, finish };
    document.body.appendChild(root);
    root.querySelector('[data-act="ok"]').focus();
  });
}
