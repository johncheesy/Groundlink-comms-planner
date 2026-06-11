/**
 * M21 §C — empty state: a centred starter card over the map on a fresh
 * session. Pure predicate first (unit-tested); createEmptyState() owns the
 * card DOM. The card never reappears once anything exists (dismiss-for-good,
 * in-memory — a fresh page load is by definition a fresh, empty mission).
 */

/**
 * A mission is empty when nothing is on the map: no AOI, no placed objects,
 * no imported overlay data. A stocked radio arsenal does NOT count — it
 * persists across sessions while the map starts blank.
 */
export function isEmptyMission({ aoiSet = false, objectCount = 0, importCount = 0 } = {}) {
  return !aoiSet && objectCount === 0 && importCount === 0;
}

/**
 * Starter card controller. host = the map wrap; actions are wired by main.js.
 * update(state) shows/hides from the predicate; any non-empty state (or the
 * dismiss ×) retires the card for good.
 */
export function createEmptyState(host, { onDrawAoi, onPlaceMast, onOpenMission } = {}) {
  let dismissed = false;

  const card = document.createElement('div');
  card.className = 'estate';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Start planning');
  card.hidden = true;
  card.innerHTML =
    `<button type="button" class="estate__close" aria-label="Dismiss">×</button>` +
    `<h2 class="estate__title">Start planning</h2>` +
    `<p class="estate__lead">Define where comms are needed, then model coverage over real terrain.</p>` +
    `<div class="estate__actions">` +
    `<button type="button" class="btn btn--primary" data-act="aoi">Draw an area</button>` +
    `<button type="button" class="btn" data-act="mast">Place a mast</button>` +
    `<button type="button" class="btn" data-act="open">Open mission / import</button>` +
    `</div>` +
    `<p class="estate__hint">Everything stays in your browser — nothing is uploaded. <kbd>⌘K</kbd> opens the command palette.</p>`;

  const retire = () => {
    dismissed = true;
    card.hidden = true;
  };

  card.querySelector('.estate__close').addEventListener('click', retire);
  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    retire(); // acting on the card is the start of a mission
    if (act === 'aoi') onDrawAoi?.();
    else if (act === 'mast') onPlaceMast?.();
    else if (act === 'open') onOpenMission?.();
  });

  host.appendChild(card);

  return {
    /** Drive visibility from gathered UI state; non-empty retires for good. */
    update(state) {
      if (dismissed) return;
      if (isEmptyMission(state)) card.hidden = false;
      else retire();
    },
    isVisible: () => !card.hidden,
    el: card,
  };
}
