# M23 — Service-worker update flow (stale-deploy fix)

## Why

Users kept seeing the old app after a deploy. Root cause: `public/sw.js` was
deliberately byte-stable across builds (a comment even said so), but the
browser's only update trigger for a service worker is a **byte-diff of the
script** — identical bytes mean the new deploy never installs, and the
cache-first app-shell strategy then serves the previous build's `index.html`
and assets indefinitely.

## Fix (three parts)

1. **Build-stamped cache identity.** The `gl-sw-stamp` Vite plugin
   (vite.config.js, `closeBundle`) replaces the `__GL_BUILD_ID__` placeholder
   in `dist/sw.js` with `version+sha` (e.g. `0.1.0+a2ee79f`) and fails the
   build loudly if the placeholder is missing. Every deploy therefore ships a
   byte-different sw.js, and the shell cache is named
   `groundlink-shell-<BUILD_ID>`. The `activate` handler deletes every cache
   except the current shell and the tile cache, so exactly one shell
   generation survives. Unbuilt copies (dev) collapse the placeholder to
   `'dev'`.

2. **Immediate takeover.** `self.skipWaiting()` on install (already present)
   plus `self.clients.claim()` on activate (already present) — no second
   reload needed for the new worker to control open tabs.

3. **Auto-reload of open tabs.** After claiming, the SW broadcasts
   `{ type: 'GL_SW_ACTIVATED', buildId }` to all window clients. The page
   (src/ui/pwa.js) reloads onto the new build via two complementary,
   deduplicated triggers: the broadcast (for tabs that were controlled at
   load) and `controllerchange` (skips the first acquisition, so the initial
   install never reloads a tab; catches the install-then-deploy-same-session
   edge). **Unsaved-work guard:** main.js passes
   `shouldAutoReload: () => !missionDirty` — a deploy never reloads over
   unsaved mission edits; the new worker already controls fetches, so the
   user's next manual reload still lands on the new build. Long-lived tabs
   also call `registration.update()` hourly and on window focus, since
   browsers otherwise only check on navigation.

## Deliberately unchanged

- **Tile cache** stays at its historical fixed name `groundlink-tiles-v1`
  (in the activate keep-set): versioning it would wipe the offline tile LRU
  (7-day TTL, 500-entry cap) on every deploy.
- **CloudRF exclusion** (`api.cloudrf.com` never cached) untouched.

## Verified

Against `vite preview` (built app, SW active): first install creates the
versioned shell cache without reloading the fresh tab; re-stamping sw.js to
simulate a deploy → new SW installs, activates with no waiting state, deletes
the old shell cache, and the open tab auto-reloads — both for a
controlled-at-load tab and for the same-session first-install edge.
