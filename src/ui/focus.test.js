import { describe, it, expect } from 'vitest';
import { focusTransition, createFocusMachine, sortEntries } from './focus.js';

/** Recording mover — the DOM controller's portal, stubbed for the pure machine. */
function recorder() {
  const moves = [];
  return { moves, move: (key, dest) => moves.push(`${key}→${dest}`) };
}

describe('focus — pure transition', () => {
  it('enters from idle', () => {
    expect(focusTransition(null, 'enter', 'power')).toBe('power');
  });
  it('switches between sections', () => {
    expect(focusTransition('power', 'enter', 'objects')).toBe('objects');
  });
  it('re-entering the focused section stays put', () => {
    expect(focusTransition('power', 'enter', 'power')).toBe('power');
  });
  it('exit and esc both return to idle', () => {
    expect(focusTransition('power', 'exit')).toBeNull();
    expect(focusTransition('power', 'esc')).toBeNull();
  });
  it('esc while idle is a no-op', () => {
    expect(focusTransition(null, 'esc')).toBeNull();
  });
});

describe('focus — machine + portal bookkeeping', () => {
  it('enter portals the node to the surface exactly once', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.enter('power');
    expect(m.current()).toBe('power');
    expect(m.isActive()).toBe(true);
    expect(moves).toEqual(['power→surface']);
  });

  it('re-entering the same section does not re-portal', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.enter('power');
    m.enter('power');
    expect(moves).toEqual(['power→surface']);
  });

  it('switching restores the previous node before portalling the next', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.enter('power');
    m.enter('objects');
    expect(moves).toEqual(['power→surface', 'power→home', 'objects→surface']);
    expect(m.current()).toBe('objects');
  });

  it('exit restores the node and goes idle', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.enter('power');
    m.exit();
    expect(moves).toEqual(['power→surface', 'power→home']);
    expect(m.current()).toBeNull();
    expect(m.isActive()).toBe(false);
  });

  it('exit while idle is a no-op (Esc semantics)', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.exit();
    expect(moves).toEqual([]);
  });

  it('a full enter/switch/exit session never leaves a node ported', () => {
    const { moves, move } = recorder();
    const m = createFocusMachine({ move });
    m.enter('a');
    m.enter('b');
    m.enter('c');
    m.exit();
    const out = moves.filter((x) => x.endsWith('→surface')).map((x) => x.split('→')[0]);
    const back = moves.filter((x) => x.endsWith('→home')).map((x) => x.split('→')[0]);
    expect(out).toEqual(['a', 'b', 'c']);
    expect(back).toEqual(['a', 'b', 'c']);
  });
});

describe('focus — objects dashboard sort', () => {
  const rows = [
    { name: 'Mast B', kind: 'mast', freq: 155 },
    { name: 'mast a', kind: 'mast', freq: 446 },
    { name: 'WP 1', kind: 'waypoint', freq: null },
  ];

  it('sorts strings case-insensitively ascending', () => {
    expect(sortEntries(rows, 'name', 1).map((r) => r.name)).toEqual(['mast a', 'Mast B', 'WP 1']);
  });
  it('descending flips the order', () => {
    expect(sortEntries(rows, 'name', -1).map((r) => r.name)).toEqual(['WP 1', 'Mast B', 'mast a']);
  });
  it('sorts numbers numerically with null/undefined last', () => {
    expect(sortEntries(rows, 'freq', 1).map((r) => r.freq)).toEqual([155, 446, null]);
  });
  it('does not mutate the input', () => {
    const before = rows.map((r) => r.name);
    sortEntries(rows, 'name', 1);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
