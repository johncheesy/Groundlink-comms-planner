import { describe, it, expect } from 'vitest';
import {
  NAV_GROUPS, groupFor, GROUPS_STORE_KEY, loadClosedGroups, saveClosedGroups,
} from './groups.js';
import { TOOLBAR_MODULES } from './toolbar.js';

describe('nav groups — shared grouping model (M20 §0)', () => {
  it('covers every TOOLBAR_MODULES key exactly once', () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.modules);
    const keys = TOOLBAR_MODULES.map((m) => m.key);
    // every module is in a group…
    for (const k of keys) expect(grouped).toContain(k);
    // …and no module is in two groups (or listed twice)
    expect(new Set(grouped).size).toBe(grouped.length);
    // …and groups contain nothing that is not a toolbar module
    for (const k of grouped) expect(keys).toContain(k);
  });

  it('keeps the four agreed clusters in order', () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(['mission', 'radios', 'analysis', 'output']);
    for (const g of NAV_GROUPS) {
      expect(typeof g.label).toBe('string');
      expect(g.label.length).toBeGreaterThan(0);
      expect(Array.isArray(g.modules)).toBe(true);
      expect(g.modules.length).toBeGreaterThan(0);
    }
  });

  it('groupFor returns the owning group for a module key', () => {
    expect(groupFor('coverage').key).toBe('analysis');
    expect(groupFor('objects').key).toBe('mission');
    expect(groupFor('roles').key).toBe('radios');
    expect(groupFor('layers').key).toBe('output');
  });

  it('groupFor throws on an unknown key', () => {
    expect(() => groupFor('nope')).toThrow();
    expect(() => groupFor('')).toThrow();
    expect(() => groupFor(undefined)).toThrow();
  });
});

describe('nav groups — persisted open/close state', () => {
  function memStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
    };
  }

  it('round-trips the closed set under gl.ui.groups.v1', () => {
    expect(GROUPS_STORE_KEY).toBe('gl.ui.groups.v1');
    const store = memStorage();
    saveClosedGroups(['output'], store);
    expect(store.getItem(GROUPS_STORE_KEY)).toBeTruthy();
    expect(loadClosedGroups(store)).toEqual(['output']);
  });

  it('defaults to everything open on a missing or corrupt store', () => {
    expect(loadClosedGroups(memStorage())).toEqual([]);
    const bad = memStorage();
    bad.setItem(GROUPS_STORE_KEY, '{not json');
    expect(loadClosedGroups(bad)).toEqual([]);
    const wrongShape = memStorage();
    wrongShape.setItem(GROUPS_STORE_KEY, '{"a":1}');
    expect(loadClosedGroups(wrongShape)).toEqual([]);
  });

  it('survives a null storage (sandboxed preview)', () => {
    expect(loadClosedGroups(null)).toEqual([]);
    expect(() => saveClosedGroups(['mission'], null)).not.toThrow();
  });
});
