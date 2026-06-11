/* GroundLink service worker — offline-capable PWA (M17).
 *
 * Workbox-free; uses the Cache API directly. Three routing strategies:
 *   • App shell (HTML/JS/CSS)  → cache-first, pre-cached on install.
 *   • Map / DEM tiles          → stale-while-revalidate, 7-day TTL, 500-tile cap.
 *   • Everything else          → network-first with cache fallback.
 *
 * Subpath-safe: the app deploys under a GitHub Pages subpath
 * (…/Groundlink-comms-planner/) and builds with Vite `base: './'`, so every
 * URL here is resolved relative to the worker's own scope rather than the
 * origin root.
 *
 * Update flow (M23): every build stamps BUILD_ID below, so each deploy ships
 * a byte-different sw.js → the browser installs it, skipWaiting() +
 * clients.claim() switch it in without a second reload, activate deletes the
 * previous build's shell cache and broadcasts GL_SW_ACTIVATED so open tabs
 * reload onto the new build (pwa.js; skipped while the mission has unsaved
 * changes).
 */

// Build stamp injected by the Vite build (gl-sw-stamp plugin replaces the
// placeholder with version+sha). A new deploy therefore changes sw.js bytes,
// which is what makes the browser install the new worker at all — the old
// byte-stable SW was why users kept seeing stale builds. In dev / unbuilt
// copies the placeholder survives; collapse it to 'dev'.
let BUILD_ID = '__GL_BUILD_ID__';
if (BUILD_ID.includes('GL_BUILD_ID')) BUILD_ID = 'dev';

// Shell cache is per-build: the activate step deletes every other groundlink
// cache except the tile cache, so one stale-shell generation never outlives a
// deploy. The tile cache name is deliberately FIXED at its historical value —
// versioning it would wipe the offline tile LRU on every deploy.
const APP_SHELL_CACHE = `groundlink-shell-${BUILD_ID}`;
const TILE_CACHE = 'groundlink-tiles-v1';
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TILE_MAX_ENTRIES = 500;

// Custom header stamped on cached tiles so we can age them out (the upstream
// Date header is unreliable / often absent on tile CDNs).
const CACHED_AT_HEADER = 'x-gl-cached-at';

// Resolve against the worker scope so paths work under any deploy subpath.
const scoped = (path) => new URL(path, self.registration.scope).toString();

// Minimal shell. The hashed Vite assets are appended at install time from
// the build-generated sw-assets.json manifest.
const APP_SHELL_URLS = ['.', 'index.html', 'manifest.webmanifest'];

// Tile providers (basemaps + DEM) — matched against request hostnames/paths.
const TILE_HOST_PATTERNS = [
  /\.mapbox\.com$/,
  /\.basemaps\.cartocdn\.com$/,
  /(^|\.)tile\.opentopomap\.org$/,
  /(^|\.)opentopomap\.org$/,
  /(^|\.)tile\.openstreetmap\.org$/,
  /\.arcgisonline\.com$/,
  /(^|\.)openfreemap\.org$/,
  /(^|\.)openmaptiles\.org$/,
  /tiles\.maps\.eox\.at$/,
];
// DEM tiles live on a shared S3 host, so match by path as well as host.
const TILE_PATH_PATTERNS = [/elevation-tiles-prod/];

function isTileRequest(url) {
  if (TILE_PATH_PATTERNS.some((re) => re.test(url.pathname) || re.test(url.hostname))) return true;
  return TILE_HOST_PATTERNS.some((re) => re.test(url.hostname));
}

// ---- install: pre-cache the app shell -------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      const urls = new Set(APP_SHELL_URLS.map(scoped));

      // Pull the hashed asset list emitted by the Vite build plugin.
      try {
        const res = await fetch(scoped('sw-assets.json'), { cache: 'no-cache' });
        if (res.ok) {
          const assets = await res.json();
          for (const a of assets) urls.add(scoped(a));
        }
      } catch {
        /* dev / first run before a build — shell pre-cache is best-effort */
      }

      // addAll is atomic; cache individually so one 404 can't abort the lot.
      await Promise.all(
        [...urls].map(async (u) => {
          try {
            const res = await fetch(u, { cache: 'no-cache' });
            if (res.ok) await cache.put(u, res.clone());
          } catch {
            /* skip unreachable shell entries on first install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// ---- activate: drop stale cache versions, take over, notify ---------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_SHELL_CACHE, TILE_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      // Control every open tab immediately (no second reload needed), then
      // tell each one a new build is live so the page can refresh itself.
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.postMessage({ type: 'GL_SW_ACTIVATED', buildId: BUILD_ID });
    })(),
  );
});

// ---- fetch: route by request type -----------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never cache CloudRF API requests (API key in Authorization header)
  if (url.hostname === 'api.cloudrf.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(request));
    return;
  }

  // Navigations and same-origin assets → cache-first off the shell.
  if (request.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(appShellStrategy(request));
    return;
  }

  // Cross-origin (fonts, etc.) → network-first with cache fallback.
  event.respondWith(networkFirst(request));
});

// Cache-first: shell assets are content-hashed, so a hit is always valid.
// Navigation requests fall back to the cached index.html when offline.
async function appShellStrategy(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    if (request.mode === 'navigate') {
      const shell =
        (await cache.match(scoped('index.html'))) || (await cache.match(scoped('.')));
      if (shell) return shell;
    }
    throw err;
  }
}

// Stale-while-revalidate for tiles, with a 7-day freshness window.
// Serve the cache immediately when present and still fresh; otherwise wait
// for the network. Either way we kick off a background refresh.
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  const fresh = cached && !isExpired(cached);

  const network = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(request, await stampNow(res.clone()));
        limitTileCache(cache, TILE_MAX_ENTRIES);
      }
      return res;
    })
    .catch(() => null);

  if (fresh) return cached;
  const res = await network;
  if (res) return res;
  if (cached) return cached; // stale beats nothing when offline
  return new Response('', { status: 504, statusText: 'Offline — tile unavailable' });
}

async function networkFirst(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// Stamp a response with the cache time so we can expire it later. Opaque
// (no-cors) responses can't have their headers read back, so we leave them
// unstamped — they fall back to being treated as fresh.
function stampNow(response) {
  if (response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(currentTimeMs()));
  return response.blob().then(
    (body) => new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}

function isExpired(response) {
  const stamp = Number(response.headers.get(CACHED_AT_HEADER));
  if (!stamp) return false; // unstamped (opaque) → assume fresh
  return currentTimeMs() - stamp > TILE_MAX_AGE_MS;
}

function currentTimeMs() {
  // performance.timeOrigin + now() avoids relying on Date in the SW global.
  return Math.round(performance.timeOrigin + performance.now());
}

// Evict the oldest tiles (insertion order) when the cache exceeds the cap.
async function limitTileCache(cache, maxEntries = TILE_MAX_ENTRIES) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const excess = keys.slice(0, keys.length - maxEntries);
    await Promise.all(excess.map((k) => cache.delete(k)));
  }
}

// Let the page trigger an immediate update (skip the waiting state).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
