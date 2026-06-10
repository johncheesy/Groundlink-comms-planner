/**
 * M19 (rev 2) — left-panel section tabs. Every `.section` becomes a tab the
 * user opens and closes from its header (and from the top toolbar icons);
 * the body slides shut via the grid 1fr→0fr track transition in CSS.
 *
 * Pure state helpers first (unit-tested, DOM-free); createSectionTabs() wires
 * the DOM. The CLOSED set persists in localStorage (`gl.ui.tabs.v1`) — a UI
 * preference like the theme; storing what's closed means new sections added
 * in later milestones default to open.
 */

export const TABS_STORE_KEY = 'gl.ui.tabs.v1';

/** Toggle one tab key in a closed-set (returns a new array). */
export function toggleTab(closed, key) {
  return closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key];
}

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // sandboxed preview: storage access itself throws
  }
};

/** Load the closed-tab keys; [] (everything open) on missing/corrupt store. */
export function loadClosedTabs(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(TABS_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist the closed-tab keys; storage failures are silently ignored. */
export function saveClosedTabs(closed, storage = defaultStorage()) {
  try {
    storage?.setItem(TABS_STORE_KEY, JSON.stringify(closed));
  } catch {
    /* UI pref only — safe to drop */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make every `.section` in `panelBody` an open/closable tab. The tab key is
 * the section's `aria-labelledby` heading id (or its own id). Headers get
 * role="button", aria-expanded, Enter/Space toggling and a chevron.
 *
 * opts: { onChange(key, open) } — fired per user toggle (toolbar mirrors it).
 */
export function createSectionTabs(panelBody, { onChange } = {}) {
  let closed = loadClosedTabs();
  const sections = new Map(); // key -> section element

  function keyFor(section) {
    return section.getAttribute('aria-labelledby') || section.id || '';
  }

  function applyOne(section, key) {
    const open = !closed.includes(key);
    section.dataset.open = String(open);
    section.querySelector('.section__head')?.setAttribute('aria-expanded', String(open));
  }

  function setOpen(key, open) {
    const willClose = !open;
    const isClosed = closed.includes(key);
    if (willClose === isClosed) return; // already in that state
    closed = toggleTab(closed, key);
    saveClosedTabs(closed);
    const section = sections.get(key);
    if (section) applyOne(section, key);
    onChange?.(key, open);
  }

  for (const section of panelBody.querySelectorAll('.section')) {
    const key = keyFor(section);
    if (!key) continue;
    sections.set(key, section);
    const head = section.querySelector('.section__head');
    if (head) {
      head.classList.add('section__head--tab');
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      const toggle = () => setOpen(key, closed.includes(key));
      head.addEventListener('click', (e) => {
        // Let real controls inside the header (badges are spans) work as-is.
        if (e.target.closest('button, a, input, select, label')) return;
        toggle();
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }
    applyOne(section, key);
  }

  return {
    setOpen,
    toggle: (key) => setOpen(key, closed.includes(key)),
    isOpen: (key) => !closed.includes(key),
    keys: () => [...sections.keys()],
    /** Open a tab and scroll its section into view (toolbar/edit jumps). */
    reveal(key) {
      setOpen(key, true);
      sections.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };
}
