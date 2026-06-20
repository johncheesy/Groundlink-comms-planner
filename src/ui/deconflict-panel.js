/**
 * M39 — Frequency deconfliction UI panel.
 *
 * Shows conflicts found by freq-deconflict.js in the Comms Plan section.
 * Usage:
 *   const panel = createDeconflictPanel(hostEl);
 *   panel.update(arsenal);  // call whenever radios change
 *   panel.clear();
 */

import { deconflict, deconflictSummary } from '../analysis/freq-deconflict.js';

const e = (tag, cls, ...children) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (c == null) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

export function createDeconflictPanel(host) {
  function render(conflicts) {
    host.innerHTML = '';

    const { errors, warnings, ok } = deconflictSummary(conflicts);

    // Summary pill row
    const summary = e('div', 'deco-summary');
    if (ok) {
      summary.append(e('span', 'badge badge--ok deco-badge', '✓ No freq conflicts'));
    } else {
      if (errors > 0) {
        summary.append(e('span', 'badge badge--bad deco-badge',
          `${errors} error${errors > 1 ? 's' : ''}`));
      }
      if (warnings > 0) {
        summary.append(e('span', 'badge badge--warn deco-badge',
          `${warnings} warning${warnings > 1 ? 's' : ''}`));
      }
    }
    host.append(summary);

    if (conflicts.length === 0) return;

    // Conflict list
    const list = e('div', 'deco-list');
    for (const c of conflicts) {
      const item = e('div', `deco-item deco-item--${c.severity}`);
      const ico = e('span', 'deco-item__ico', c.severity === 'error' ? '✕' : '⚠');
      const msg = e('span', 'deco-item__msg', c.message);
      item.append(ico, msg);
      list.append(item);
    }
    host.append(list);
  }

  return {
    update(arsenal) {
      if (!arsenal?.length) {
        host.innerHTML = '<p class="help">Add radios to run freq deconfliction.</p>';
        return;
      }
      const conflicts = deconflict(arsenal);
      render(conflicts);
    },
    clear() {
      host.innerHTML = '';
    },
    /** Returns the current conflict count { errors, warnings } for badge update */
    check(arsenal) {
      if (!arsenal?.length) return { errors: 0, warnings: 0, ok: true };
      return deconflictSummary(deconflict(arsenal));
    },
  };
}
