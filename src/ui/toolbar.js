/**
 * M19 (rev 2) — top icon toolbar; M20 §1 — grouped clusters + plan stepper.
 * One icon per left-panel tab, clustered per NAV_GROUPS with an 11 px group
 * label under each cluster and hairline separators between them; clicking
 * opens/closes that tab in the left menu. Right side: search, basemap, theme
 * toggle, settings. aria-pressed mirrors the tab's open state.
 *
 * The stepper chip (1 Mission · 2 Radios · 3 Plan) sits right of the module
 * clusters and renders from planState() (planstate.js); clicking a step jumps
 * to that group's first relevant tab.
 *
 * Keyboard: one tab stop with a roving tabindex; ←/→ move between buttons.
 */
import { MODULE_ICONS } from './icons.js';
import { NAV_GROUPS, groupFor } from './groups.js';

/** Toolbar tabs; anchor = section heading id = tab key. */
export const TOOLBAR_MODULES = [
  { key: 'objects', label: 'Objects', anchor: 'objectsTitle' },
  { key: 'mission', label: 'Mission', anchor: 'missionTitle' },
  { key: 'aoi', label: 'Area of interest', anchor: 'aoiTitle' },
  { key: 'radios', label: 'Radios', anchor: 'radioTitle' },
  { key: 'roles', label: 'Node roles', anchor: 'rolesTitle' },
  { key: 'coverage', label: 'Coverage', anchor: 'coverageTitle' },
  { key: 'sites', label: 'Site recommendation', anchor: 'siteTitle' },
  { key: 'drone', label: 'Drone relay', anchor: 'droneTitle' },
  { key: 'pace', label: 'Comms plan', anchor: 'paceTitle' },
  { key: 'export', label: 'Data export', anchor: 'dataExportTitle' },
  { key: 'power', label: 'Power & endurance', anchor: 'powerTitle' },
  { key: 'cellular', label: 'Cellular coverage', anchor: 'cellTitle' },
  { key: 'layers', label: 'Layers', anchor: 'featTitle' },
];

export const MODULE_BY_KEY = Object.fromEntries(TOOLBAR_MODULES.map((m) => [m.key, m]));

/** The section element a heading id belongs to. */
export function sectionForAnchor(anchorId) {
  return document.getElementById(anchorId)?.closest('.section') ?? null;
}

const STEPS = [
  { key: 'mission', n: 1, label: 'Mission' },
  { key: 'radios', n: 2, label: 'Radios' },
  { key: 'plan', n: 3, label: 'Plan' },
];

export function createToolbar(els, { onModule, onSearch, onBasemap, onSettings, onStep } = {}) {
  const { modulesHost, stepperHost, rightHost } = els;
  const moduleButtons = new Map(); // anchor -> button

  function iconButton(key, label, icon, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar__btn';
    btn.dataset.module = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    btn.addEventListener('click', handler);
    return btn;
  }

  // ── Module clusters (M20 §1) ────────────────────────────────────────────
  for (const g of NAV_GROUPS) {
    const cluster = document.createElement('div');
    cluster.className = 'toolbar__group';
    cluster.setAttribute('role', 'group');
    cluster.setAttribute('aria-label', g.label);
    const row = document.createElement('div');
    row.className = 'toolbar__group-btns';
    for (const key of g.modules) {
      const m = MODULE_BY_KEY[key];
      const btn = iconButton(m.key, `${m.label} — ${groupFor(m.key).label}`, MODULE_ICONS[m.key], () => onModule?.(m));
      btn.title = m.label;
      btn.setAttribute('aria-pressed', 'false');
      moduleButtons.set(m.anchor, btn);
      row.appendChild(btn);
    }
    const label = document.createElement('span');
    label.className = 'toolbar__group-label';
    label.textContent = g.label;
    label.setAttribute('aria-hidden', 'true');
    cluster.append(row, label);
    modulesHost.appendChild(cluster);
  }

  // ── Plan stepper chip (M20 §1) ──────────────────────────────────────────
  const stepButtons = new Map(); // step key -> button
  if (stepperHost) {
    stepperHost.setAttribute('role', 'group');
    stepperHost.setAttribute('aria-label', 'Plan progress');
    STEPS.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plan-stepper__step';
      btn.dataset.step = s.key;
      btn.innerHTML =
        `<span class="plan-stepper__num" aria-hidden="true">${s.n}</span>` +
        `<span class="plan-stepper__label">${s.label}</span>`;
      btn.addEventListener('click', () => onStep?.(s.key));
      stepButtons.set(s.key, btn);
      stepperHost.appendChild(btn);
      if (i < STEPS.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'plan-stepper__sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        stepperHost.appendChild(sep);
      }
    });
  }

  /** Re-render the stepper from a planState() result. */
  function updateStepper(ps) {
    if (!stepperHost) return;
    for (const s of STEPS) {
      const btn = stepButtons.get(s.key);
      const done = ps.done[s.key];
      const current = !done && ps.step === s.n;
      btn.classList.toggle('is-done', done);
      btn.classList.toggle('is-current', current);
      btn.querySelector('.plan-stepper__num').textContent = done ? '✓' : String(s.n);
      const state = done ? 'done' : current ? 'current step' : 'to do';
      btn.setAttribute('aria-label', `Step ${s.n} ${s.label} — ${state}`);
    }
    stepperHost.classList.toggle('is-stale', Boolean(ps.stale));
  }

  rightHost.prepend(
    iconButton('search', 'Search / command palette (Cmd-K or Ctrl-K)', MODULE_ICONS.search, () => onSearch?.()),
    iconButton('basemap', 'Switch basemap', MODULE_ICONS.basemap, () => onBasemap?.()),
  );
  rightHost.appendChild(
    iconButton('settings', 'Settings', MODULE_ICONS.settings, () => onSettings?.()),
  );

  // Roving tabindex across every toolbar button (incl. the stepper and the
  // relocated theme toggle, which is already in rightHost's markup).
  const allButtons = () => [...els.root.querySelectorAll('button')];
  allButtons().forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
  els.root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = allButtons();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list.forEach((b) => { b.tabIndex = -1; });
    list[next].tabIndex = 0;
    list[next].focus();
  });

  /** Mirror one tab's open state on its icon (multiple can be active). */
  function setPressed(anchor, on) {
    const b = moduleButtons.get(anchor);
    if (!b) return;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  }

  return { setPressed, updateStepper };
}
