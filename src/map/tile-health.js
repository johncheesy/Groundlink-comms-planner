/**
 * Basemap tile health — decides when a raster provider is "down" and what to
 * switch to. Pure logic (no map, no DOM) so it is unit-tested; map.js feeds it
 * MapLibre events and acts on the answers.
 *
 * Why: the default imagery provider can be unreachable for one user (network
 * block, firewall, regional filter, rate limit) while everything else works.
 * Without this the map is just black and nothing explains why.
 *
 * Three signals trip a source:
 *   • hard errors  — network/CORS failure (status 0), 401/403/429, 5xx;
 *                    404 and 204 are normal "no tile here" answers and ignored
 *   • stall        — tiles requested, nothing answered for `stallMs`
 *                    (a firewall that drops packets never produces an error)
 *   • known block  — the provider's host failed recently (persisted, TTL)
 */

export const HEALTH_DEFAULTS = Object.freeze({
  minErrors: 5, //   hard errors inside the window…
  windowMs: 12_000, // …window length
  stallMs: 10_000, //  requested but unanswered for this long, zero successes
});

export const BLOCKED_TTL_MS = 30 * 60_000;
export const BLOCKED_STORAGE_KEY = 'gl.basemap.blocked.v1';

/** True for failures that mean "this provider is not delivering". */
export function isHardTileError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  const s = err.status;
  if (s === undefined || s === null) return true; // thrown network error, no HTTP status
  if (s === 404 || s === 204 || s === 410) return false; // legitimately empty
  return s === 0 || s === 401 || s === 403 || s === 429 || s >= 500;
}

/** Hostname of a variant's first tile URL (placeholders stripped). */
export function hostOf(variant) {
  const raw = variant?.tiles?.[0];
  if (!raw) return null;
  const m = /^https?:\/\/([^/?#]+)/i.exec(raw.replace(/\{[^}]*\}/g, 'x'));
  return m ? m[1].toLowerCase() : null;
}

/** Second-level domain, so server./services./clarity.arcgisonline.com group together. */
export function providerOf(host) {
  if (!host) return null;
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

/**
 * Per-source health tracker. `now` is injected for deterministic tests.
 */
export function createTileHealth(opts = {}) {
  const cfg = { ...HEALTH_DEFAULTS, ...opts };
  const st = new Map(); // id -> { errors:[t], successes:[t], pending:number, lastProgress:number, firstReq:number, okEver:boolean, tripped:boolean }

  const get = (id, now) => {
    let s = st.get(id);
    if (!s) {
      s = { errors: [], successes: [], pending: 0, lastProgress: now, firstReq: 0, okEver: false, tripped: false };
      st.set(id, s);
    }
    return s;
  };
  const prune = (s, now) => {
    const cut = now - cfg.windowMs;
    while (s.errors.length && s.errors[0] < cut) s.errors.shift();
    while (s.successes.length && s.successes[0] < cut) s.successes.shift();
  };

  return {
    /** A tile request started. */
    loading(id, now) {
      const s = get(id, now);
      if (s.pending === 0) s.lastProgress = now;
      if (!s.firstReq) s.firstReq = now;
      s.pending += 1;
    },
    /** A tile arrived. */
    success(id, now) {
      const s = get(id, now);
      s.successes.push(now);
      s.okEver = true;
      s.pending = Math.max(0, s.pending - 1);
      s.lastProgress = now;
    },
    /** A tile failed. Soft errors (404…) only close the pending request. */
    error(id, err, now) {
      const s = get(id, now);
      s.pending = Math.max(0, s.pending - 1);
      s.lastProgress = now;
      if (isHardTileError(err)) s.errors.push(now);
    },
    /**
     * Should this source be declared down? Latches until reset().
     * `sourcePending` lets the caller pass the map's own truth (isSourceLoaded
     * is false while tiles are outstanding). MapLibre swallows 404s without an
     * event, so our own pending counter alone could miss them.
     */
    tripped(id, now, { sourcePending } = {}) {
      const s = st.get(id);
      if (!s) return false;
      if (s.tripped) return true;
      prune(s, now);
      const hardFail = s.errors.length >= cfg.minErrors && s.errors.length > s.successes.length * 2;
      const waiting = sourcePending === undefined ? s.pending > 0 : sourcePending && s.firstReq > 0;
      const stalled = !s.okEver && waiting && now - s.lastProgress >= cfg.stallMs;
      if (hardFail || stalled) s.tripped = true;
      return s.tripped;
    },
    reset(id) { st.delete(id); },
    snapshot(id) { const s = st.get(id); return s ? { errors: s.errors.length, successes: s.successes.length, pending: s.pending, tripped: s.tripped } : null; },
  };
}

// ---- failover choice -------------------------------------------------------

/**
 * Pick where to go when `current` is down.
 *
 * @param {object} p
 * @param {object} p.variants       BASEMAP_VARIANTS ({ imagery:[…], topo:[…] })
 * @param {string} p.category       category of the failed variant
 * @param {string} p.variantId      the failed variant
 * @param {Set<string>} p.blockedProviders  provider domains known to be down
 * @returns {{category:string, variantId:string, degraded:boolean}|null}
 *   degraded = we had to leave satellite imagery for a street map.
 */
export function pickFallback({ variants, category, variantId, blockedProviders = new Set() }) {
  const usable = (v) => v.id !== variantId && v.global !== false && !blockedProviders.has(providerOf(hostOf(v)));
  const same = (variants[category] || []).find(usable);
  if (same) return { category, variantId: same.id, degraded: false };
  if (category === 'imagery') {
    const topo = (variants.topo || []).find((v) => v.global !== false && !blockedProviders.has(providerOf(hostOf(v))));
    if (topo) return { category: 'topo', variantId: topo.id, degraded: true };
  }
  return null;
}

// ---- persistence of "this provider is blocked" -----------------------------

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

/** @returns {Set<string>} provider domains blocked within the TTL */
export function readBlocked({ storage = defaultStorage(), now = Date.now(), ttlMs = BLOCKED_TTL_MS } = {}) {
  try {
    const raw = storage?.getItem(BLOCKED_STORAGE_KEY);
    if (!raw) return new Set();
    const obj = JSON.parse(raw);
    return new Set(Object.entries(obj || {}).filter(([, t]) => typeof t === 'number' && now - t < ttlMs).map(([k]) => k));
  } catch (_) { return new Set(); }
}

export function markBlocked(provider, { storage = defaultStorage(), now = Date.now(), ttlMs = BLOCKED_TTL_MS } = {}) {
  if (!provider) return;
  try {
    const raw = storage?.getItem(BLOCKED_STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    const next = {};
    for (const [k, t] of Object.entries(obj || {})) if (typeof t === 'number' && now - t < ttlMs) next[k] = t;
    next[provider] = now;
    storage?.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(next));
  } catch (_) { /* private mode / quota: failover still works for this session */ }
}

export function clearBlocked(provider, { storage = defaultStorage() } = {}) {
  try {
    const raw = storage?.getItem(BLOCKED_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) || {};
    delete obj[provider];
    storage?.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(obj));
  } catch (_) { /* ignore */ }
}

/**
 * Which variant should the map START on, given providers known to be down?
 * Returns null when the default is fine.
 */
export function pickStartVariant({ variants, category, defaultVariantId, blockedProviders }) {
  const def = (variants[category] || []).find((v) => v.id === defaultVariantId);
  if (!def || !blockedProviders.has(providerOf(hostOf(def)))) return null;
  return pickFallback({ variants, category, variantId: defaultVariantId, blockedProviders });
}
