import { describe, it, expect, vi } from 'vitest';
import { createUndoStack } from './undo.js';

/** A trackable op: label + spies for both directions. */
function op(label) {
  return { label, undo: vi.fn(), redo: vi.fn() };
}

describe('undo stack — ordering', () => {
  it('undoes in reverse push order', () => {
    const s = createUndoStack();
    const a = op('a');
    const b = op('b');
    s.push(a);
    s.push(b);
    expect(s.undo()).toBe(b);
    expect(b.undo).toHaveBeenCalledOnce();
    expect(s.undo()).toBe(a);
    expect(a.undo).toHaveBeenCalledOnce();
    expect(s.undo()).toBeNull();
  });

  it('redo replays in original order', () => {
    const s = createUndoStack();
    const a = op('a');
    const b = op('b');
    s.push(a);
    s.push(b);
    s.undo();
    s.undo();
    expect(s.redo()).toBe(a);
    expect(a.redo).toHaveBeenCalledOnce();
    expect(s.redo()).toBe(b);
    expect(s.redo()).toBeNull();
  });

  it('canUndo / canRedo track the stacks', () => {
    const s = createUndoStack();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    s.push(op('a'));
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);
  });
});

describe('undo stack — depth cap and invalidation', () => {
  it('caps at the configured depth, dropping the oldest', () => {
    const s = createUndoStack({ depth: 3 });
    const ops = ['a', 'b', 'c', 'd'].map(op);
    ops.forEach((o) => s.push(o));
    expect(s.undo().label).toBe('d');
    expect(s.undo().label).toBe('c');
    expect(s.undo().label).toBe('b');
    expect(s.undo()).toBeNull(); // 'a' fell off the bottom
  });

  it('a new op invalidates the redo branch', () => {
    const s = createUndoStack();
    s.push(op('a'));
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.push(op('b'));
    expect(s.canRedo()).toBe(false);
    expect(s.redo()).toBeNull();
  });
});

describe('undo stack — re-entrancy guard', () => {
  it('pushes during undo()/redo() are dropped (inverse ops must not re-record)', () => {
    const s = createUndoStack();
    const a = {
      label: 'a',
      // Mimics main.js: the wrapped registry op fires again while undoing.
      undo: () => s.push(op('echo')),
      redo: () => s.push(op('echo')),
    };
    s.push(a);
    s.undo();
    expect(s.canUndo()).toBe(false); // the echo push was suppressed
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.canRedo()).toBe(false);
    expect(s.canUndo()).toBe(true); // only 'a' itself came back
    expect(s.undo()).toBe(a);
  });

  it('exposes isApplying() for callers that need their own guards', () => {
    const s = createUndoStack();
    let seen = null;
    s.push({ label: 'a', undo: () => { seen = s.isApplying(); }, redo: () => {} });
    s.undo();
    expect(seen).toBe(true);
    expect(s.isApplying()).toBe(false);
  });
});

describe('undo stack — delete-restore payload', () => {
  it('carries the full snapshot through undo and redo (registry delete pattern)', () => {
    const s = createUndoStack();
    const live = new Map([['m1', { kind: 'mast', name: 'Mast A', lngLat: [0.5, 0.5] }]]);
    const snap = { ...live.get('m1') };
    let restoredId = null;
    s.push({
      label: 'Mast A deleted',
      undo: () => { restoredId = 'm2'; live.set(restoredId, { ...snap }); },
      redo: () => { live.delete(restoredId); },
    });
    live.delete('m1'); // the original delete
    s.undo();
    expect(live.get('m2')).toEqual(snap);
    s.redo();
    expect(live.size).toBe(0);
  });

  it('clear() empties both stacks (mission load discards history)', () => {
    const s = createUndoStack();
    s.push(op('a'));
    s.undo();
    s.push(op('b'));
    s.clear();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });
});
