// M17 — Progressive Web App wiring: service-worker registration, the offline
// status indicator, and the install prompt. Kept side-effect-free until
// initPwa() is called from main.js.

// Resolve the SW URL against the Vite base so it works at the origin root
// (dev) and under the GitHub Pages subpath (build). Scope defaults to the
// SW's own directory, which matches the deployed app.
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

// How often a long-lived tab re-checks sw.js for a new deploy. Browsers only
// check on navigation by themselves, so a tab left open would otherwise not
// see an update for hours.
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * M23 update flow: each deploy ships a byte-different sw.js (build-stamped),
 * the new worker skipWaiting()s + claim()s, then broadcasts GL_SW_ACTIVATED.
 * On that signal (or the controllerchange it implies) we reload the tab onto
 * the new build — unless `shouldAutoReload` says no (unsaved mission edits);
 * in that case the new worker already controls fetches, so the user's next
 * manual reload is fresh anyway.
 */
function registerServiceWorker({ shouldAutoReload } = {}) {
  if (!('serviceWorker' in navigator)) return;
  // Skip in dev: there's no built sw-assets.json and the cache-first shell
  // strategy fights Vite's HMR.
  if (import.meta.env.DEV) return;

  // First-install safety: claim() on the very first SW must not reload a tab
  // the user just opened. Two complementary guards (the reloading flag dedupes
  // when both fire for the same update):
  //  - wasControlledAtLoad (frozen): the GL_SW_ACTIVATED broadcast only
  //    reloads tabs that were already running under a previous SW.
  //  - knownController (live): controllerchange skips the first acquisition
  //    (initial claim) and reloads on every later one — this also covers the
  //    install-then-deploy-in-the-same-session edge the frozen flag misses.
  const wasControlledAtLoad = Boolean(navigator.serviceWorker.controller);
  let knownController = wasControlledAtLoad;
  let reloading = false;
  const reloadOntoNewBuild = (buildId) => {
    if (reloading) return;
    if (shouldAutoReload && !shouldAutoReload()) {
      console.info('[SW] new build active — reload deferred (unsaved changes)');
      return;
    }
    reloading = true;
    console.info('[SW] reloading onto new build', buildId ?? '');
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'GL_SW_ACTIVATED') return;
    if (wasControlledAtLoad) reloadOntoNewBuild(e.data.buildId);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const first = !knownController;
    knownController = true;
    if (!first) reloadOntoNewBuild();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => {
        console.info('[SW] registered', reg.scope);
        // Proactive update checks for long-lived tabs: hourly and whenever
        // the tab regains focus (update() is a no-op when nothing changed).
        setInterval(() => reg.update().catch(() => {}), SW_UPDATE_INTERVAL_MS);
        window.addEventListener('focus', () => reg.update().catch(() => {}));
      })
      .catch((err) => console.warn('[SW] registration failed', err));
  });
}

// Toggle the status-bar offline chip (and its separator) with connectivity.
function initOfflineIndicator() {
  const chip = document.getElementById('offlineIndicator');
  const sep = document.getElementById('statusOfflineSep');
  if (!chip) return;

  const sync = () => {
    const offline = !navigator.onLine;
    chip.toggleAttribute('hidden', !offline);
    sep?.toggleAttribute('hidden', !offline);
  };

  window.addEventListener('offline', sync);
  window.addEventListener('online', sync);
  sync(); // reflect the state at load
}

// Reveal the Install button when the browser offers an install prompt, and
// drive the prompt on click. Hidden again once installed or dismissed.
function initInstallPrompt() {
  const btn = document.getElementById('installBtn');
  if (!btn) return;

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.removeAttribute('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      // The prompt can only be used once; hide regardless of the choice.
      btn.setAttribute('hidden', '');
      deferredPrompt = null;
    }
  });

  // Once installed, the button has no further purpose.
  window.addEventListener('appinstalled', () => {
    btn.setAttribute('hidden', '');
    deferredPrompt = null;
  });
}

/** opts.shouldAutoReload() — return false to defer the on-deploy tab reload. */
export function initPwa(opts = {}) {
  registerServiceWorker(opts);
  initOfflineIndicator();
  initInstallPrompt();
}
