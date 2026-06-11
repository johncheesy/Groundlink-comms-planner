/**
 * M20 §0 — shared grouping model. One source of truth for the four nav
 * clusters, used by the top toolbar, the left-menu group headers and the
 * collapsed icon strip. Keys are TOOLBAR_MODULES keys (toolbar.js).
 */

export const NAV_GROUPS = [
  { key: 'mission', label: 'Mission', modules: ['objects', 'mission', 'aoi'] },
  { key: 'radios', label: 'Radios', modules: ['radios', 'roles'] },
  { key: 'analysis', label: 'Analysis', modules: ['coverage', 'sites', 'drone', 'cellular'] },
  { key: 'output', label: 'Output', modules: ['pace', 'power', 'export', 'layers'] },
];

/** The group owning a module key. Unknown keys are a programming error. */
export function groupFor(moduleKey) {
  const g = NAV_GROUPS.find((grp) => grp.modules.includes(moduleKey));
  if (!g) throw new Error(`No nav group for module: ${moduleKey}`);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted open/close state — same pattern/class as gl.ui.tabs.v1 (tabs.js):
// store what is CLOSED so future groups default to open.
// ─────────────────────────────────────────────────────────────────────────────

export const GROUPS_STORE_KEY = 'gl.ui.groups.v1';

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // sandboxed preview: storage access itself throws
  }
};

/** Load the closed-group keys; [] (everything open) on missing/corrupt store. */
export function loadClosedGroups(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(GROUPS_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist the closed-group keys; storage failures are silently ignored. */
export function saveClosedGroups(closed, storage = defaultStorage()) {
  try {
    storage?.setItem(GROUPS_STORE_KEY, JSON.stringify(closed));
  } catch {
    /* UI pref only — safe to drop */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM controller — the .panel-group wrappers in index.html (M20 §2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire every `.panel-group` in `panelBody`: the sticky header toggles all
 * member tabs together (the wrapper's body show/hides); member tabs keep
 * their own toggles. Badges render into the header's badge span via
 * `setBadges` (renderBadge from badges.js).
 */
export function createPanelGroups(panelBody, { renderBadge } = {}) {
  let closed = loadClosedGroups();
  const groups = new Map(); // key -> { wrap, head, badge }

  function applyOne(key) {
    const g = groups.get(key);
    if (!g) return;
    const open = !closed.includes(key);
    g.wrap.dataset.open = String(open);
    g.head.setAttribute('aria-expanded', String(open));
  }

  function setOpen(key, open) {
    const isClosed = closed.includes(key);
    if (!open === isClosed) return;
    closed = isClosed ? closed.filter((k) => k !== key) : [...closed, key];
    saveClosedGroups(closed);
    applyOne(key);
  }

  for (const wrap of panelBody.querySelectorAll('.panel-group')) {
    const key = wrap.dataset.group;
    const head = wrap.querySelector('.panel-group__head');
    if (!key || !head) continue;
    groups.set(key, { wrap, head, badge: wrap.querySelector('.panel-group__badge') });
    head.addEventListener('click', () => setOpen(key, closed.includes(key)));
    applyOne(key);
  }

  return {
    setOpen,
    isOpen: (key) => !closed.includes(key),
    /** Make sure the group holding a module is expanded (reveal jumps). */
    openForModule(moduleKey) {
      try {
        setOpen(groupFor(moduleKey).key, true);
      } catch {
        /* non-module section (e.g. legend) — nothing to open */
      }
    },
    setBadges(groupBadges = {}) {
      for (const [key, g] of groups) renderBadge?.(g.badge, groupBadges[key]);
    },
  };
}
