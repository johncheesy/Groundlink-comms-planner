// M17 — Progressive Web App wiring: service-worker registration, the offline
// status indicator, and the install prompt. Kept side-effect-free until
// initPwa() is called from main.js.

// Resolve the SW URL against the Vite base so it works at the origin root
// (dev) and under the GitHub Pages subpath (build). Scope defaults to the
// SW's own directory, which matches the deployed app.
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Skip in dev: there's no built sw-assets.json and the cache-first shell
  // strategy fights Vite's HMR.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => console.info('[SW] registered', reg.scope))
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

export function initPwa() {
  registerServiceWorker();
  initOfflineIndicator();
  initInstallPrompt();
}
