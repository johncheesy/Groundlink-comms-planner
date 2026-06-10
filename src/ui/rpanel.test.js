import { describe, it, expect } from 'vitest';
import {
  RPANEL_MIN_W, RPANEL_MAX_W, RPANEL_DEFAULT_W, RPANEL_STORE_KEY,
  clampRpanelWidth, loadRpanelPrefs, saveRpanelPrefs,
} from './rpanel.js';

/** Minimal in-memory localStorage stand-in (tests run DOM-free). */
function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe('right panel — width clamp', () => {
  it('clamps below the minimum to 200', () => {
    expect(clampRpanelWidth(10)).toBe(RPANEL_MIN_W);
    expect(clampRpanelWidth(199.4)).toBe(RPANEL_MIN_W);
  });

  it('clamps above the maximum to 480', () => {
    expect(clampRpanelWidth(9000)).toBe(RPANEL_MAX_W);
    expect(clampRpanelWidth(481)).toBe(RPANEL_MAX_W);
  });

  it('passes in-range values through (rounded to whole px)', () => {
    expect(clampRpanelWidth(200)).toBe(200);
    expect(clampRpanelWidth(333.6)).toBe(334);
    expect(clampRpanelWidth(480)).toBe(480);
  });

  it('falls back to the default for non-numeric input', () => {
    expect(clampRpanelWidth('garbage')).toBe(RPANEL_DEFAULT_W);
    expect(clampRpanelWidth(NaN)).toBe(RPANEL_DEFAULT_W);
    expect(clampRpanelWidth(undefined)).toBe(RPANEL_DEFAULT_W);
  });

  it('spec metrics: min 200 · max 480 · default 280', () => {
    expect(RPANEL_MIN_W).toBe(200);
    expect(RPANEL_MAX_W).toBe(480);
    expect(RPANEL_DEFAULT_W).toBe(280);
  });
});

describe('right panel — persist / restore', () => {
  it('round-trips width + open state through storage', () => {
    const store = memStorage();
    saveRpanelPrefs({ w: 333, open: false }, store);
    expect(loadRpanelPrefs(store)).toEqual({ w: 333, open: false });
  });

  it('uses the gl.ui.rpanel.v1 key', () => {
    const store = memStorage();
    saveRpanelPrefs({ w: 240, open: true }, store);
    expect(store.getItem(RPANEL_STORE_KEY)).toBeTruthy();
    expect(RPANEL_STORE_KEY).toBe('gl.ui.rpanel.v1');
  });

  it('clamps a persisted out-of-range width on load', () => {
    const store = memStorage({ [RPANEL_STORE_KEY]: JSON.stringify({ w: 9999, open: true }) });
    expect(loadRpanelPrefs(store).w).toBe(RPANEL_MAX_W);
  });

  it('returns defaults for missing or corrupt storage', () => {
    expect(loadRpanelPrefs(memStorage())).toEqual({ w: RPANEL_DEFAULT_W, open: true });
    const corrupt = memStorage({ [RPANEL_STORE_KEY]: 'not json{' });
    expect(loadRpanelPrefs(corrupt)).toEqual({ w: RPANEL_DEFAULT_W, open: true });
  });

  it('survives a throwing storage (sandboxed preview rule)', () => {
    const throwing = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    expect(loadRpanelPrefs(throwing)).toEqual({ w: RPANEL_DEFAULT_W, open: true });
    expect(() => saveRpanelPrefs({ w: 300, open: true }, throwing)).not.toThrow();
  });
});

describe('right panel — double-click reset', () => {
  it('reset value is the default width', () => {
    // Double-click handler sets the width back to RPANEL_DEFAULT_W; the value
    // itself is the contract (the DOM handler is exercised in the browser).
    expect(clampRpanelWidth(RPANEL_DEFAULT_W)).toBe(280);
  });
});
