/**
 * Light / dark theme toggle.
 *
 * Sets `data-theme` on the document root: '' (light, default) or 'dark'.
 * The map canvas stays dark in both themes — that's handled in CSS via the
 * shared --mapbg token, not here.
 *
 * Persistence: in-memory only. Per the project OPSEC/preview constraints we do
 * NOT assume localStorage is available (embedded previews). On the hosted
 * origin a later step may opt into persistence; for now the choice resets on
 * reload, which is safe everywhere.
 */

const root = document.documentElement;

export function getTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Wire a toggle button. Returns a cleanup function. */
export function initThemeToggle(button, onChange) {
  if (!button) return () => {};
  const handler = () => {
    const next = toggleTheme();
    button.setAttribute('aria-pressed', String(next === 'dark'));
    onChange?.(next);
  };
  button.addEventListener('click', handler);
  return () => button.removeEventListener('click', handler);
}
