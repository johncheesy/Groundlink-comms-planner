import { describe, it, expect } from 'vitest';
import { TABS_STORE_KEY, loadClosedTabs, saveClosedTabs, toggleTab } from './tabs.js';

/** Minimal in-memory localStorage stand-in (tests run DOM-free). */
function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

describe('section tabs — open/close state', () => {
  it('toggleTab closes an open tab and reopens a closed one', () => {
    let closed = [];
    closed = toggleTab(closed, 'coverage');
    expect(closed).toContain('coverage');
    closed = toggleTab(closed, 'coverage');
    expect(closed).not.toContain('coverage');
  });

  it('toggleTab leaves other tabs untouched', () => {
    const closed = toggleTab(['radios'], 'coverage');
    expect(closed.sort()).toEqual(['coverage', 'radios']);
  });

  it('does not mutate the input array', () => {
    const input = ['radios'];
    toggleTab(input, 'coverage');
    expect(input).toEqual(['radios']);
  });
});

describe('section tabs — persist / restore', () => {
  it('round-trips the closed set under gl.ui.tabs.v1', () => {
    const store = memStorage();
    saveClosedTabs(['pace', 'power'], store);
    expect(loadClosedTabs(store)).toEqual(['pace', 'power']);
    expect(TABS_STORE_KEY).toBe('gl.ui.tabs.v1');
    expect(store.getItem(TABS_STORE_KEY)).toBeTruthy();
  });

  it('defaults to everything open (empty closed set)', () => {
    expect(loadClosedTabs(memStorage())).toEqual([]);
  });

  it('survives corrupt or throwing storage', () => {
    expect(loadClosedTabs(memStorage({ [TABS_STORE_KEY]: 'not json{' }))).toEqual([]);
    const throwing = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    expect(loadClosedTabs(throwing)).toEqual([]);
    expect(() => saveClosedTabs(['x'], throwing)).not.toThrow();
  });

  it('drops non-string entries from a tampered store', () => {
    const store = memStorage({ [TABS_STORE_KEY]: JSON.stringify(['ok', 7, null]) });
    expect(loadClosedTabs(store)).toEqual(['ok']);
  });
});
