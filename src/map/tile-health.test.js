import { describe, it, expect } from 'vitest';
import {
  isHardTileError, hostOf, providerOf, createTileHealth, pickFallback,
  readBlocked, markBlocked, clearBlocked, pickStartVariant, BLOCKED_TTL_MS, BLOCKED_STORAGE_KEY,
} from './tile-health.js';
import { BASEMAP_VARIANTS } from './basemaps.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };

describe('isHardTileError', () => {
  it('counts network, CORS-opaque and provider-refusal errors', () => {
    for (const status of [0, 401, 403, 429, 500, 502, 503]) expect(isHardTileError({ status })).toBe(true);
    expect(isHardTileError(new TypeError('Failed to fetch'))).toBe(true); // no status at all
  });
  it('ignores empty-tile answers and aborts', () => {
    for (const status of [404, 204, 410]) expect(isHardTileError({ status })).toBe(false);
    expect(isHardTileError({ name: 'AbortError' })).toBe(false);
    expect(isHardTileError(null)).toBe(false);
  });
});

describe('hostOf / providerOf', () => {
  it('extracts hosts from tile templates incl. WMS bbox placeholders', () => {
    expect(hostOf({ tiles: ['https://server.arcgisonline.com/ArcGIS/{z}/{y}/{x}'] })).toBe('server.arcgisonline.com');
    expect(hostOf({ tiles: ['https://tiles.maps.eox.at/wms?bbox={bbox-epsg-3857}'] })).toBe('tiles.maps.eox.at');
    expect(hostOf({})).toBeNull();
  });
  it('groups sibling hosts under one provider', () => {
    expect(providerOf('server.arcgisonline.com')).toBe('arcgisonline.com');
    expect(providerOf('services.arcgisonline.com')).toBe('arcgisonline.com');
    expect(providerOf('tile.openstreetmap.org')).toBe('openstreetmap.org');
    expect(providerOf('localhost')).toBe('localhost');
  });
});

describe('createTileHealth', () => {
  const T = (n) => 1_000_000 + n;
  it('trips after enough hard errors with no successes', () => {
    const h = createTileHealth();
    for (let i = 0; i < 4; i++) { h.loading('s', T(i)); h.error('s', { status: 0 }, T(i + 1)); }
    expect(h.tripped('s', T(100))).toBe(false); // 4 < 5
    h.loading('s', T(5)); h.error('s', { status: 403 }, T(6));
    expect(h.tripped('s', T(7))).toBe(true);
  });
  it('does not trip on 404s (tiles outside coverage)', () => {
    const h = createTileHealth();
    for (let i = 0; i < 30; i++) { h.loading('s', T(i)); h.error('s', { status: 404 }, T(i)); }
    expect(h.tripped('s', T(40))).toBe(false);
  });
  it('does not trip when most tiles still arrive', () => {
    const h = createTileHealth();
    for (let i = 0; i < 20; i++) { h.loading('s', T(i)); h.success('s', T(i)); }
    for (let i = 0; i < 6; i++) { h.loading('s', T(30 + i)); h.error('s', { status: 503 }, T(30 + i)); }
    expect(h.tripped('s', T(50))).toBe(false); // 6 errors vs 20 successes
  });
  it('forgets errors outside the window', () => {
    const h = createTileHealth({ windowMs: 1000 });
    for (let i = 0; i < 5; i++) { h.loading('s', T(0)); h.error('s', { status: 0 }, T(i)); }
    expect(h.tripped('s', T(5000))).toBe(false);
  });
  it('trips on a stall: requests out, nothing answered, never worked', () => {
    const h = createTileHealth({ stallMs: 10_000 });
    h.loading('s', T(0)); h.loading('s', T(10));
    expect(h.tripped('s', T(9_000))).toBe(false);
    expect(h.tripped('s', T(10_001))).toBe(true);
  });
  it('a provider that has worked once is not declared stalled (slow ≠ down)', () => {
    const h = createTileHealth({ stallMs: 10_000 });
    h.loading('s', T(0)); h.success('s', T(100));
    h.loading('s', T(200));
    expect(h.tripped('s', T(60_000))).toBe(false);
  });
  it('latches until reset', () => {
    const h = createTileHealth({ stallMs: 1000 });
    h.loading('s', T(0));
    expect(h.tripped('s', T(2000))).toBe(true);
    h.success('s', T(2500));
    expect(h.tripped('s', T(2600))).toBe(true);
    h.reset('s');
    expect(h.tripped('s', T(2700))).toBe(false);
  });
  it('tracks sources independently', () => {
    const h = createTileHealth();
    for (let i = 0; i < 6; i++) { h.loading('a', T(i)); h.error('a', { status: 0 }, T(i)); }
    expect(h.tripped('a', T(10))).toBe(true);
    expect(h.tripped('b', T(10))).toBe(false);
  });
});

describe('pickFallback with the real basemap list', () => {
  const blocked = new Set(['arcgisonline.com']);
  it('imagery: Esri down → a global non-Esri imagery layer (Sentinel-2)', () => {
    const r = pickFallback({ variants: BASEMAP_VARIANTS, category: 'imagery', variantId: 'esri-imagery', blockedProviders: blocked });
    expect(r).toEqual({ category: 'imagery', variantId: 's2cloudless-2024', degraded: false });
  });
  it('never picks the regional-only NL layer as an automatic fallback', () => {
    const r = pickFallback({ variants: BASEMAP_VARIANTS, category: 'imagery', variantId: 'esri-imagery', blockedProviders: blocked });
    expect(r.variantId).not.toBe('pdok-nl-ortho');
  });
  it('all imagery down → street map, flagged degraded, never an Esri one', () => {
    const r = pickFallback({ variants: BASEMAP_VARIANTS, category: 'imagery', variantId: 's2cloudless-2024', blockedProviders: new Set(['arcgisonline.com', 'eox.at']) });
    expect(r.degraded).toBe(true);
    expect(r.category).toBe('topo');
    const v = BASEMAP_VARIANTS.topo.find((x) => x.id === r.variantId);
    expect(hostOf(v)).not.toMatch(/arcgisonline/);
  });
  it('topo: skips blocked Esri siblings', () => {
    const r = pickFallback({ variants: BASEMAP_VARIANTS, category: 'topo', variantId: 'opentopomap', blockedProviders: blocked });
    const v = BASEMAP_VARIANTS.topo.find((x) => x.id === r.variantId);
    expect(r.degraded).toBe(false);
    expect(hostOf(v)).not.toMatch(/arcgisonline/);
  });
  it('returns null when nothing is left', () => {
    const everything = new Set(['arcgisonline.com', 'eox.at', 'opentopomap.org', 'openstreetmap.org', 'cartocdn.com', 'pdok.nl']);
    expect(pickFallback({ variants: BASEMAP_VARIANTS, category: 'imagery', variantId: 'esri-imagery', blockedProviders: everything })).toBeNull();
  });
});

describe('blocked-provider persistence', () => {
  it('round-trips and expires', () => {
    const storage = memStorage();
    markBlocked('arcgisonline.com', { storage, now: 1000 });
    expect(readBlocked({ storage, now: 2000 }).has('arcgisonline.com')).toBe(true);
    expect(readBlocked({ storage, now: 1000 + BLOCKED_TTL_MS + 1 }).has('arcgisonline.com')).toBe(false);
  });
  it('clearBlocked removes only that provider', () => {
    const storage = memStorage();
    markBlocked('a.com', { storage, now: 1 }); markBlocked('b.com', { storage, now: 1 });
    clearBlocked('a.com', { storage });
    const s = readBlocked({ storage, now: 2 });
    expect(s.has('a.com')).toBe(false);
    expect(s.has('b.com')).toBe(true);
  });
  it('survives corrupt or throwing storage', () => {
    const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    expect(readBlocked({ storage: bad }).size).toBe(0);
    expect(() => markBlocked('x.com', { storage: bad })).not.toThrow();
    const thrower = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readBlocked({ storage: thrower }).size).toBe(0);
  });
  it('uses the documented storage key', () => {
    const storage = memStorage(); markBlocked('x.com', { storage, now: 1 });
    expect(storage._m.has(BLOCKED_STORAGE_KEY)).toBe(true);
  });
});

describe('pickStartVariant', () => {
  it('keeps the default when its provider is healthy', () => {
    expect(pickStartVariant({ variants: BASEMAP_VARIANTS, category: 'imagery', defaultVariantId: 'esri-imagery', blockedProviders: new Set() })).toBeNull();
  });
  it('starts on the fallback when the default provider is known to be down', () => {
    const r = pickStartVariant({ variants: BASEMAP_VARIANTS, category: 'imagery', defaultVariantId: 'esri-imagery', blockedProviders: new Set(['arcgisonline.com']) });
    expect(r.variantId).toBe('s2cloudless-2024');
  });
});
