/**
 * M19 §5 — left panel collapse to a 52 px icon strip. The sections stay
 * untouched; collapsed state swaps the grid track to --panel-w-collapsed and
 * shows a vertical strip of module icons (same set as the toolbar). Clicking
 * a strip icon expands the panel AND scrolls to that section (one click,
 * never a hover flyout). State persists in localStorage (`gl.ui.lpanel.v1`)
 * — UI preference only, same class as the theme.
 */
import { MODULE_ICONS } from './icons.js';
import { TOOLBAR_MODULES, sectionForAnchor } from './toolbar.js';
import { renderBadge } from './badges.js';

export const LPANEL_STORE_KEY = 'gl.ui.lpanel.v1';

function loadCollapsed() {
  try {
    return localStorage.getItem(LPANEL_STORE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}
function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(LPANEL_STORE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* sandboxed preview — UI pref only */
  }
}

/**
 * opts.intercept({ type: 'expand' | 'module', module? }) — M21 focus mode
 * hook: return true to swallow a strip click (focus switches section instead
 * of expanding the panel); return false to keep the normal behaviour.
 */
export function createLeftPanel({ app, strip, collapseBtn, onResize, reveal, intercept }) {
  let collapsed = false;

  function apply() {
    app.dataset.collapsed = collapsed ? 'true' : 'false';
    collapseBtn?.setAttribute('aria-expanded', String(!collapsed));
    // Map needs a resize once the grid track transition lands (≤150 ms).
    setTimeout(() => onResize?.(), 180);
  }

  function setCollapsed(next, { persist = true } = {}) {
    collapsed = Boolean(next);
    if (persist) saveCollapsed(collapsed);
    apply();
  }

  // ── Icon strip ───────────────────────────────────────────────────────────
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'panel-strip__btn panel-strip__btn--expand';
  expand.title = 'Expand panel';
  expand.setAttribute('aria-label', 'Expand mission panel');
  expand.innerHTML =
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  expand.addEventListener('click', () => {
    if (intercept?.({ type: 'expand' })) return;
    setCollapsed(false);
  });
  strip.appendChild(expand);

  const stripBadges = new Map(); // module key -> badge span (M20 §2)
  const stripButtons = new Map(); // module key -> button (M21 focus highlight)
  for (const m of TOOLBAR_MODULES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-strip__btn';
    btn.title = m.label;
    btn.setAttribute('aria-label', `${m.label} — expand panel`);
    btn.innerHTML = MODULE_ICONS[m.key];
    const badge = document.createElement('span');
    badge.className = 'gl-badge gl-badge--strip';
    badge.hidden = true;
    btn.appendChild(badge);
    stripBadges.set(m.key, badge);
    stripButtons.set(m.key, btn);
    btn.addEventListener('click', () => {
      if (intercept?.({ type: 'module', module: m })) return;
      setCollapsed(false);
      // Open + scroll once the panel has its width back.
      setTimeout(() => {
        if (reveal) reveal(m.anchor);
        else sectionForAnchor(m.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 170);
    });
    strip.appendChild(btn);
  }

  collapseBtn?.addEventListener('click', () => setCollapsed(!collapsed));

  // Restore persisted state (desktop only — mobile uses the slide-over).
  collapsed = loadCollapsed();
  apply();

  return {
    setCollapsed,
    isCollapsed: () => collapsed,
    toggle: () => setCollapsed(!collapsed),
    /** M20 §2: mirror the per-module badges onto the strip icons. */
    setBadges(moduleBadges = {}) {
      for (const [key, el] of stripBadges) renderBadge(el, moduleBadges[key]);
    },
    /** M21 focus mode: highlight the focused module's strip icon (null clears). */
    setFocused(moduleKey) {
      for (const [key, btn] of stripButtons) btn.classList.toggle('is-focused', key === moduleKey);
    },
  };
}
