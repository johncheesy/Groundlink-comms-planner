/**
 * Light / dark theme toggle.
 *
 * Sets `data-theme` on the document root: '' (light) or 'dark'.
 * The map canvas stays dark in both themes — handled in CSS via the shared
 * --mapbg token, not here.
 *
 * First load follows the OS preference (`prefers-color-scheme`); after that the
 * user's explicit toggle wins for the session. Persistence is in-memory only —
 * per the project constraints we don't assume localStorage exists (embedded
 * previews). On the hosted origin a later step may opt into persistence.
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

/** True if the OS currently prefers a dark colour scheme. */
export function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Apply the initial theme from the OS preference (light default otherwise).
 * Only call once, before first paint, when the user hasn't chosen yet.
 */
export function applyInitialTheme() {
  setTheme(systemPrefersDark() ? 'dark' : 'light');
  return getTheme();
}

/**
 * Wire a toggle button. Reflects state via aria-pressed and label, calls
 * onChange with the new theme. Returns a cleanup function.
 */
export function initThemeToggle(button, onChange) {
  if (!button) return () => {};

  const reflect = () => {
    const dark = getTheme() === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };

  // Track the OS scheme until the user makes an explicit choice this session.
  let userChose = false;
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemChange = (e) => {
    if (userChose) return;
    setTheme(e.matches ? 'dark' : 'light');
    reflect();
    onChange?.(getTheme());
  };
  mql?.addEventListener?.('change', onSystemChange);

  const handler = () => {
    userChose = true;
    const next = toggleTheme();
    reflect();
    onChange?.(next);
  };
  button.addEventListener('click', handler);

  reflect();

  return () => {
    button.removeEventListener('click', handler);
    mql?.removeEventListener?.('change', onSystemChange);
  };
}
