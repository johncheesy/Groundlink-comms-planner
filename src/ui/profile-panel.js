/**
 * Floating path-profile drawer (M14). A slide-up panel pinned to the bottom of
 * the map canvas that hosts the terrain cross-section + link-budget chart.
 *
 * In-memory only; created once, shown/hidden on demand.
 */

import { renderProfileChart } from '../analysis/profile-chart.js';

const fmtKm = (km) => (km >= 10 ? km.toFixed(0) : km.toFixed(1));

/**
 * @param {HTMLElement} mapContainer  element the drawer is appended to
 * @param {{ onClose?: () => void }} [opts]
 * @returns {{ show(data): void, hide(): void, isVisible: boolean }}
 */
export function createProfilePanel(mapContainer, { onClose } = {}) {
  const panel = document.createElement('div');
  panel.className = 'profile-panel';
  panel.hidden = true;
  panel.innerHTML =
    `<div class="profile-panel__header">` +
    `<span class="profile-panel__title">Path Profile</span>` +
    `<span class="profile-panel__meta" data-numeric></span>` +
    `<button type="button" class="profile-panel__close" aria-label="Close path profile" title="Close">×</button>` +
    `</div>` +
    `<div class="profile-panel__body"></div>`;
  mapContainer.appendChild(panel);

  const metaEl = panel.querySelector('.profile-panel__meta');
  const bodyEl = panel.querySelector('.profile-panel__body');
  const closeBtn = panel.querySelector('.profile-panel__close');

  const api = {
    isVisible: false,
    show(data) {
      metaEl.textContent = `${fmtKm(data.distanceKm)} km · ${Math.round(data.freqMHz)} MHz`;
      renderProfileChart(bodyEl, data);
      panel.hidden = false;
      api.isVisible = true;
    },
    hide() {
      if (!api.isVisible && panel.hidden) return;
      panel.hidden = true;
      api.isVisible = false;
      onClose?.();
    },
  };

  closeBtn.addEventListener('click', () => api.hide());
  return api;
}
