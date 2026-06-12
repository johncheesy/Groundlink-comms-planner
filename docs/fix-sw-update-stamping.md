# Fix — SW build-stamping & precache manifest dead under Vite 6

*June 2026. Follow-up to M17 (offline PWA) and M23 (SW update flow).
File: `vite.config.js`.*

## Symptom

Deploys completed green but **clients never received new builds**: the live
site served the previous build's badge/assets even after a verified Pages
deploy, and `sw-assets.json` returned 404 in production.

## Root cause

Both PWA build plugins (`gl-sw-assets`, `gl-sw-stamp`) gate on
`isAppBundle(bundle) = Boolean(bundle['index.html'])` to skip the nested
worker sub-builds. Under the Vite 6 in use (6.4.3), **the HTML is emitted
after plugin `generateBundle` runs** — the app build's bundle has only the
JS/CSS chunks (37 keys, no `index.html`). The gate was therefore false for
*every* build:

- `gl-sw-stamp` never replaced `__GL_BUILD_ID__` → `sw.js` fell back to
  `BUILD_ID = 'dev'`, byte-identical on every deploy. The browser's SW update
  check is a byte-diff, so no new SW ever installed and the `'dev'`-named
  cache pinned each client to the **first build their browser ever cached**.
  This is why fixes "didn't render" after deploying: the deploy was fine, the
  browser never loaded it.
- `gl-sw-assets` never emitted `sw-assets.json` → the M17 offline shell had
  no precache manifest (404).

The loud-failure guard in `gl-sw-stamp` (`closeBundle` throws if stamping
fails) never fired because the skip happened one step earlier — the flag that
arms `closeBundle` is set in the gated `generateBundle`.

## Fix

Gate on what the app bundle reliably contains at `generateBundle` time — its
main entry chunk:

```js
const isAppBundle = (bundle) =>
  Object.values(bundle).some(
    (o) => o.type === 'chunk' && o.isEntry && /^assets\/index-/.test(o.fileName),
  );
```

Worker sub-builds' entries are `assets/<name>.worker-*.js`, so they still
skip. Verified after the fix: `dist/sw.js` carries `BUILD_ID = '0.1.0+<sha>'`
and `dist/sw-assets.json` lists all 19 hashed assets (worker chunks included —
Vite 6 folds worker sub-build outputs into the parent bundle, so the manifest
is complete for offline use).

## Recovery for pinned clients

No client action needed: Pages serves `sw.js` with `max-age=600`; on the next
visit the browser byte-diffs the **stamped** sw.js against the cached `'dev'`
one, installs the new SW, and the M23 flow (build-named caches +
`skipWaiting`) takes the current deploy live.
