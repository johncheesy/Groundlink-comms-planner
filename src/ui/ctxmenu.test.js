import { describe, it, expect } from 'vitest';
import { buildMenuModel, COORD_MENU_FORMATS } from './ctxmenu.js';

// Synthetic coordinates only (OPSEC).
const entry = (over = {}) => ({
  id: 'm1', kind: 'mast', name: 'Mast A', lngLat: [0.5, 0.75], locked: false, ...over,
});

const itemIds = (model) => model.items.map((i) => i.id);

describe('context-menu model — header + coordinates', () => {
  it('carries the object name and kind label', () => {
    const m = buildMenuModel(entry());
    expect(m.header.name).toBe('Mast A');
    expect(m.header.kind).toBeTruthy();
  });

  it('always lists the three coordinate formats: lat/long · MGRS · UTM', () => {
    expect(COORD_MENU_FORMATS).toEqual(['latlng', 'mgrs', 'utm']);
    for (const kind of ['tx', 'mast', 'repeater', 'marker', 'waypoint', 'drone']) {
      const m = buildMenuModel(entry({ kind }));
      expect(m.coords.map((c) => c.fmt)).toEqual(['latlng', 'mgrs', 'utm']);
      // every row carries copyable text
      for (const c of m.coords) expect(typeof c.text).toBe('string');
    }
  });

  it('locked objects still expose all three coord formats', () => {
    const m = buildMenuModel(entry({ locked: true }));
    expect(m.coords).toHaveLength(3);
  });
});

describe('context-menu model — per-kind items', () => {
  it('masts / repeaters / tx / drone get Settings', () => {
    for (const kind of ['mast', 'repeater', 'tx', 'drone']) {
      expect(itemIds(buildMenuModel(entry({ kind })))).toContain('settings');
    }
  });

  it('markers and waypoints have no Settings item', () => {
    for (const kind of ['marker', 'waypoint']) {
      expect(itemIds(buildMenuModel(entry({ kind })))).not.toContain('settings');
    }
  });

  it('unlocked objects get Rename, Move and Delete', () => {
    const ids = itemIds(buildMenuModel(entry()));
    expect(ids).toContain('rename');
    expect(ids).toContain('move');
    expect(ids).toContain('delete');
    expect(ids).not.toContain('unlock');
  });

  it('locked objects show Unlock instead of Move', () => {
    const ids = itemIds(buildMenuModel(entry({ locked: true })));
    expect(ids).toContain('unlock');
    expect(ids).not.toContain('move');
  });

  it('every item has a human label', () => {
    for (const i of buildMenuModel(entry()).items) {
      expect(typeof i.label).toBe('string');
      expect(i.label.length).toBeGreaterThan(0);
    }
  });
});
