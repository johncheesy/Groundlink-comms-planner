/**
 * M21 §D — undo stack for registry operations (move / rename / delete).
 * Pure + DOM-free. Ops are inverse pairs: { label, undo(), redo() }.
 *
 * Re-entrancy guard built in: main.js wraps the registry mutators to push an
 * op per user action, and replaying an op drives those same mutators — so
 * push() while an op is applying is silently dropped instead of every undo
 * recording itself as a fresh action.
 */

export const UNDO_DEPTH = 20;

export function createUndoStack({ depth = UNDO_DEPTH, onChange } = {}) {
  const undoOps = [];
  const redoOps = [];
  let applying = false;

  const changed = () => onChange?.({ canUndo: undoOps.length > 0, canRedo: redoOps.length > 0 });

  function push(op) {
    if (applying) return false;
    undoOps.push(op);
    if (undoOps.length > depth) undoOps.shift();
    redoOps.length = 0; // a new action invalidates the redo branch
    changed();
    return true;
  }

  function apply(from, to, dir) {
    const op = from.pop();
    if (!op) return null;
    applying = true;
    try {
      op[dir]();
    } finally {
      applying = false;
    }
    to.push(op);
    changed();
    return op;
  }

  return {
    push,
    undo: () => apply(undoOps, redoOps, 'undo'),
    redo: () => apply(redoOps, undoOps, 'redo'),
    canUndo: () => undoOps.length > 0,
    canRedo: () => redoOps.length > 0,
    isApplying: () => applying,
    clear() {
      undoOps.length = 0;
      redoOps.length = 0;
      changed();
    },
  };
}
