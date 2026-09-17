/**
 * M48 — CelesTrak GP/TLE loader with a browser-side cache.
 *
 * CelesTrak serves `gp.php?GROUP=<group>&FORMAT=tle` with
 * `Access-Control-Allow-Origin: *`, so a static GitHub Pages build can fetch
 * it directly — no proxy, no key. CelesTrak asks clients not to re-fetch a
 * group more often than about every 2 h; we cache for 6 h in localStorage
 * (public orbital data, not user state — allowed by the storage policy in
 * CLAUDE.md, always behind try/catch) and serve a stale copy when offline.
 *
 * `https://celestrak.org` is on the CSP connect-src allowlist in index.html.
 */

const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';
export const TLE_TTL_MS = 6 * 3600_000;
const KEY = (group) => `gl.tle.${group}.v1`;

function readCache(storage, group) {
  try {
    const raw = storage?.getItem(KEY(group));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.text !== 'string' || typeof obj.fetchedAt !== 'number') return null;
    return obj;
  } catch (_) { return null; }
}

function writeCache(storage, group, text, fetchedAt) {
  try { storage?.setItem(KEY(group), JSON.stringify({ text, fetchedAt })); } catch (_) { /* quota / private mode */ }
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

/**
 * Load one CelesTrak group as raw TLE text.
 * @param {string} group   e.g. 'iridium-NEXT', 'globalstar', 'ses'
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl]   injectable for tests
 * @param {number} [opts.now]
 * @param {Storage|null} [opts.storage]
 * @param {number} [opts.ttlMs]
 * @returns {Promise<{ text: string, fetchedAt: number, stale: boolean, fromCache: boolean }>}
 * @throws when there is no network response AND no cached copy
 */
export async function loadGroupTle(group, {
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  storage = defaultStorage(),
  ttlMs = TLE_TTL_MS,
} = {}) {
  const cached = readCache(storage, group);
  if (cached && now - cached.fetchedAt < ttlMs) {
    return { text: cached.text, fetchedAt: cached.fetchedAt, stale: false, fromCache: true };
  }
  try {
    if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
    const url = `${CELESTRAK_GP}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`CelesTrak ${res.status}`);
    const text = await res.text();
    if (!/^1 /m.test(text)) throw new Error('CelesTrak response is not TLE text');
    writeCache(storage, group, text, now);
    return { text, fetchedAt: now, stale: false, fromCache: false };
  } catch (err) {
    if (cached) return { text: cached.text, fetchedAt: cached.fetchedAt, stale: true, fromCache: true };
    throw err;
  }
}
