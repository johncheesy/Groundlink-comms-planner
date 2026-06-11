/**
 * M20 §5 — flyout state machine for the right map rail. Pure state (TDD);
 * the DOM wiring in main.js subscribes via onChange and shows/hides the
 * matching flyout panel. One flyout open at a time; toggling the open one
 * closes it; Esc and map clicks close whatever is open.
 */

export function createRailState({ onChange } = {}) {
  let open = null;

  function set(next) {
    if (next === open) return;
    open = next;
    onChange?.(open);
  }

  return {
    current: () => open,
    isOpen: (key) => open === key,
    toggle(key) {
      set(open === key ? null : key);
    },
    close() {
      set(null);
    },
  };
}
