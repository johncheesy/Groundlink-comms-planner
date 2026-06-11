import { describe, it, expect } from 'vitest';
import { createRailState } from './rail.js';

/**
 * createRailState({ onChange }) — flyout state machine for the right map
 * rail (M20 §5). One flyout open at a time; toggling the open one closes it;
 * Esc and map clicks close whatever is open. onChange(currentKey|null) fires
 * on every actual state change (not on no-ops).
 */

describe('rail flyout state machine (M20 §5)', () => {
  it('starts closed', () => {
    const rail = createRailState();
    expect(rail.current()).toBeNull();
    expect(rail.isOpen('basemap')).toBe(false);
  });

  it('toggle opens a flyout', () => {
    const rail = createRailState();
    rail.toggle('basemap');
    expect(rail.current()).toBe('basemap');
    expect(rail.isOpen('basemap')).toBe(true);
    expect(rail.isOpen('view')).toBe(false);
  });

  it('opening B closes A (one open at a time)', () => {
    const rail = createRailState();
    rail.toggle('basemap');
    rail.toggle('view');
    expect(rail.current()).toBe('view');
    expect(rail.isOpen('basemap')).toBe(false);
  });

  it('toggling the open flyout closes it', () => {
    const rail = createRailState();
    rail.toggle('view');
    rail.toggle('view');
    expect(rail.current()).toBeNull();
  });

  it('close() shuts whatever is open and is idempotent', () => {
    const rail = createRailState();
    rail.toggle('basemap');
    rail.close();
    expect(rail.current()).toBeNull();
    expect(() => rail.close()).not.toThrow();
    expect(rail.current()).toBeNull();
  });

  it('notifies onChange with the new key on every real change only', () => {
    const seen = [];
    const rail = createRailState({ onChange: (k) => seen.push(k) });
    rail.toggle('basemap'); // → basemap
    rail.toggle('view');    // → view (A closed implicitly)
    rail.toggle('view');    // → null
    rail.close();           // no-op: already closed
    expect(seen).toEqual(['basemap', 'view', null]);
  });
});
