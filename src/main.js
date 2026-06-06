import 'leaflet/dist/leaflet.css';
import '../styles/index.css';

import L from 'leaflet';
import { initMap, keepMapSized } from './map/map.js';
import { createAoiController } from './map/aoi.js';
import { initThemeToggle, applyInitialTheme } from './ui/theme.js';
import { createCoverageController } from './coverage/coverage.js';
import { wattsToDbm } from './coverage/model.js';

const $ = (sel) => document.querySelector(sel);

// First paint follows the OS colour scheme (light default otherwise).
applyInitialTheme();

// ---- Map ----------------------------------------------------------------

const { map, setBasemap } = initMap($('#map'));
const invalidate = keepMapSized(map);

// ---- Status bar ---------------------------------------------------------

const statusCoords = $('#statusCoords');
const statusZoom = $('#statusZoom');
const statusMode = $('#statusMode');
const statusAoi = $('#statusAoi');

const fmtLat = (lat) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
const fmtLng = (lng) => `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;

map.on('mousemove', (e) => {
  statusCoords.textContent = `${fmtLat(e.latlng.lat)} ${fmtLng(e.latlng.lng)}`;
});
map.on('mouseout', () => {
  statusCoords.textContent = '—';
});

const updateZoom = () => {
  statusZoom.textContent = map.getZoom().toFixed(0);
};
map.on('zoomend', updateZoom);
updateZoom();

// ---- Theme toggle -------------------------------------------------------

initThemeToggle($('#themeToggle'), () => {
  // map canvas stays dark regardless; nothing to repaint, but keep it sized
  invalidate();
});

// ---- Basemap switcher ---------------------------------------------------

const basemapSwitch = $('#basemapSwitch');
basemapSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  setBasemap(btn.dataset.basemap);
  basemapSwitch
    .querySelectorAll('.basemap-switch__btn')
    .forEach((b) => b.classList.toggle('is-active', b === btn));
});

// ---- Zoom toolbar -------------------------------------------------------

$('#zoomIn').addEventListener('click', () => map.zoomIn());
$('#zoomOut').addEventListener('click', () => map.zoomOut());

// ---- AOI drawing --------------------------------------------------------

const drawHint = $('#drawHint');
const aoiStatus = $('#aoiStatus');
const aoiReadout = $('#aoiReadout');
const drawRadiusBtn = $('#drawRadius');
const drawPolygonBtn = $('#drawPolygon');

const fmtArea = (m2) => {
  const km2 = m2 / 1e6;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²`;
  return `${(m2 / 1e4).toFixed(1)} ha`; // hectares for sub-km2 areas
};
const fmtKm = (m) => `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km`;

const fitAoiBtn = $('#fitAoi');
const clearAoiBtn = $('#clearAoi');
const computeBtn = $('#computeCoverage');

const aoi = createAoiController(map, {
  onChange(s) {
    const has = s && s.type !== null;
    fitAoiBtn.disabled = !has;
    clearAoiBtn.disabled = !has;
    computeBtn.disabled = !has;
    if (!has) {
      aoiStatus.textContent = 'none drawn';
      aoiReadout.textContent = 'No area defined yet. Pick a tool, then draw on the map.';
      statusAoi.textContent = '—';
      statusMode.textContent = 'Ready';
      return;
    }
    if (s.type === 'radius') {
      aoiStatus.textContent = 'radius';
      aoiReadout.textContent = `Radius ${fmtKm(s.radiusM)} · covering ${fmtArea(s.areaM2)}.`;
      statusAoi.textContent = `${fmtKm(s.radiusM)} r · ${fmtArea(s.areaM2)}`;
    } else {
      aoiStatus.textContent = 'polygon';
      aoiReadout.textContent = `Polygon · ${s.vertices} vertices · ${fmtArea(s.areaM2)} · ${fmtKm(
        s.perimeterM,
      )} perimeter.`;
      statusAoi.textContent = `${s.vertices} pts · ${fmtArea(s.areaM2)}`;
    }
    statusMode.textContent = 'AOI set';
    syncToolButtons();
  },
  onHint(text) {
    drawHint.classList.toggle('is-visible', Boolean(text));
    if (text) {
      // allow the "kbd" hint to render small inline markup safely
      drawHint.innerHTML = text
        .replace('Enter', '<kbd>Enter</kbd>')
        .replace('Esc', '<kbd>Esc</kbd>');
    }
    statusMode.textContent = aoi?.getMode?.()
      ? `Drawing ${aoi.getMode()}`
      : statusMode.textContent;
  },
});

function syncToolButtons() {
  const m = aoi.getMode();
  drawRadiusBtn.setAttribute('aria-pressed', String(m === 'radius'));
  drawRadiusBtn.classList.toggle('is-active', m === 'radius');
  drawPolygonBtn.setAttribute('aria-pressed', String(m === 'polygon'));
  drawPolygonBtn.classList.toggle('is-active', m === 'polygon');
  statusMode.textContent = m ? `Drawing ${m}` : statusMode.textContent;
}

drawRadiusBtn.addEventListener('click', () => {
  aoi.setMode('radius');
  syncToolButtons();
});
drawPolygonBtn.addEventListener('click', () => {
  aoi.setMode('polygon');
  syncToolButtons();
});
clearAoiBtn.addEventListener('click', () => {
  aoi.clear();
  aoi.setMode(null);
  syncToolButtons();
});
fitAoiBtn.addEventListener('click', () => aoi.fitBounds());

// ---- Coverage compute (M2) ---------------------------------------------

const freqInput = $('#freqInput');
const powerInput = $('#powerInput');
const opacityInput = $('#opacityInput');
const opacityRow = $('#opacityRow');
const clearCoverageBtn = $('#clearCoverage');
const progress = $('#coverageProgress');
const progressBar = $('#coverageProgressBar');
const coverageHelp = $('#coverageHelp');

const TX_GAIN_DBI = 2.15; // dipole reference for the default omni

const coverage = createCoverageController(map, {
  onProgress(frac) {
    progress.hidden = false;
    progressBar.style.width = `${Math.round(frac * 100)}%`;
    statusMode.textContent = frac >= 1 ? 'Coverage ready' : `Computing… ${Math.round(frac * 100)}%`;
    if (frac >= 1) {
      opacityRow.hidden = false;
      coverageHelp.textContent =
        'Flat free-space estimate from the AOI centre. Adjust opacity, or add a Mapbox token (next step) for terrain-aware coverage.';
      // let the bar finish, then tuck it away
      setTimeout(() => {
        progress.hidden = true;
        progressBar.style.width = '0%';
      }, 350);
    }
  },
  onStatus(state) {
    if (state === 'error') {
      coverageHelp.textContent = 'Coverage worker failed — see console. The flat fallback should not normally error.';
    }
  },
});

function runCoverage() {
  const area = aoi.getAoi();
  if (!area) return;
  const freqMHz = clampNum(freqInput.value, 30, 6000, 150);
  const powerW = clampNum(powerInput.value, 0.01, 100, 5);
  const eirpDbm = wattsToDbm(powerW) + TX_GAIN_DBI;
  coverage.compute(area.bounds, area.center, { eirpDbm, freqMHz, rxGainDbi: 0, clutterDb: 0 });
}

function clampNum(v, min, max, fallback) {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

computeBtn.addEventListener('click', runCoverage);
opacityInput.addEventListener('input', () => coverage.setOpacity(opacityInput.value / 100));
clearCoverageBtn.addEventListener('click', () => {
  coverage.clear();
  opacityRow.hidden = true;
  progress.hidden = true;
  progressBar.style.width = '0%';
  coverageHelp.textContent =
    'Draw an AOI, then compute. The transmitter defaults to the AOI centre. Flat free-space estimate — add a Mapbox token for terrain-aware coverage.';
});

// clearing the AOI also clears any coverage raster
clearAoiBtn.addEventListener('click', () => clearCoverageBtn.click());

// ---- Mobile slide-over panel -------------------------------------------

const app = $('#app');
const panelToggle = $('#panelToggle');
const panel = $('#panel');
const mq = window.matchMedia('(max-width: 760px)');

const openPanel = () => {
  app.dataset.panel = 'open';
  panelToggle.setAttribute('aria-expanded', 'true');
  // move focus into the panel for keyboard users
  if (mq.matches) panel.querySelector('button, [tabindex]')?.focus();
};
const closePanel = () => {
  app.dataset.panel = 'closed';
  panelToggle.setAttribute('aria-expanded', 'false');
  if (mq.matches) panelToggle.focus();
};

panelToggle.addEventListener('click', openPanel);
$('#scrim').addEventListener('click', closePanel);
$('#panelClose').addEventListener('click', closePanel);

// Esc closes the slide-over (only when open on mobile)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mq.matches && app.dataset.panel === 'open') closePanel();
});

// close the slide-over after the user commits to drawing on the map (mobile)
[drawRadiusBtn, drawPolygonBtn].forEach((b) =>
  b.addEventListener('click', () => {
    if (mq.matches) closePanel();
  }),
);

// Fix Leaflet's default marker icon paths under Vite (not used yet, but safe).
delete L.Icon.Default.prototype._getIconUrl;

// Ensure correct sizing after first paint.
requestAnimationFrame(invalidate);

// Dev-only handle for testing/automation (stripped from production builds).
if (import.meta.env.DEV) {
  window.__gl = { map, aoi };
}
