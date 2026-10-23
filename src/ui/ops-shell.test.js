import { describe, it, expect } from 'vitest';
import { isOpsWorkspace, drawerTabs, moduleForAnchor } from './ops-shell.js';

describe('isOpsWorkspace', () => {
  it('is the default; only ?ws=classic turns it off', () => {
    expect(isOpsWorkspace('?ws=ops')).toBe(true);
    expect(isOpsWorkspace('?a=1&ws=ops')).toBe(true);
    expect(isOpsWorkspace('')).toBe(true);
    expect(isOpsWorkspace(undefined)).toBe(true);
    expect(isOpsWorkspace('?ws=classic')).toBe(false);
    expect(isOpsWorkspace('?x=1&ws=classic')).toBe(false);
  });
});

describe('drawerTabs', () => {
  it('lists the four tabs in order with dashes for unknown counts', () => {
    expect(drawerTabs().map((t) => `${t.label} ${t.count}`)).toEqual(['Sites —', 'Links —', 'Gaps —', 'Radios —']);
  });
  it('renders numbers as given', () => {
    const t = drawerTabs({ sites: 3, links: 0, radios: 4 });
    expect(t.map((x) => x.count)).toEqual(['3', '0', '—', '4']);
  });
});

describe('moduleForAnchor', () => {
  const mods = [{ key: 'aoi', label: 'Area', anchor: 'aoiTitle' }, { key: 'pace', label: 'PACE', anchor: 'paceTitle' }];
  it('finds the module by its section anchor', () => {
    expect(moduleForAnchor(mods, 'paceTitle')?.key).toBe('pace');
    expect(moduleForAnchor(mods, 'nope')).toBeNull();
  });
});
